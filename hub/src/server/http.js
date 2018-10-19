/* @flow */

import express from 'express'
import expressWinston from 'express-winston'
import logger from 'winston'
import cors from 'cors'

import { ProofChecker } from './ProofChecker'
import { getChallengeText, LATEST_AUTH_VERSION } from './authentication'
import { HubServer } from './server'

function writeResponse(res: express.response, data: Object, statusCode: number) {
  res.writeHead(statusCode, {'Content-Type' : 'application/json'})
  res.write(JSON.stringify(data))
  res.end()
}

export function makeHttpServer(config: Object) {
  const app = express()

  // Handle driver configuration
  let driver
  if (config.driver === 'aws') {
    const S3Driver = require('./drivers/S3Driver')
    driver = new S3Driver(config)
  } else if (config.driver === 'azure') {
    const AzDriver = require('./drivers/AzDriver')
    driver = new AzDriver(config)
  } else if (config.driver === 'disk') {
    const DiskDriver = require('./drivers/diskDriver')
    driver = new DiskDriver(config)
  } else if (config.driver === 'google-cloud') {
    const GcDriver = require('./drivers/GcDriver')
    driver = new GcDriver(config)
  } else if (config.driver === 'ipfs') {
    const IPFSDriver = require('./drivers/IPFSDriver')
    driver = new IPFSDriver(config)
  } else if (config.driverClass) {
    driver = new config.driverClass(config)
  } else {
    logger.error('Failed to load driver. Check driver configuration.')
    throw new Error('Failed to load driver')
  }

  const proofChecker = new ProofChecker(config.proofsConfig)
  const server = new HubServer(driver, proofChecker, config)

  app.config = config
  app.driver = driver

  // Instantiate server logging with Winston
  app.use(expressWinston.logger({
    transports: logger.loggers.default.transports }))

  app.use(cors())

  // sadly, express doesn't like to capture slashes.
  //  but that's okay! regexes solve that problem
  app.post(/^\/store\/([a-zA-Z0-9]+)\/(.+)/, (req: express.request,
                                              res: express.response) => {
    let filename = req.params[1]
    if (filename.endsWith('/')){
      filename = filename.substring(0, filename.length - 1)
    }
    const address = req.params[0]

    server.handleRequest(address, filename, req.headers, req)
      .then((publicURL) => {
        writeResponse(res, { publicURL }, 202)
      })
      .catch((err) => {
        logger.error(err)
        if (err.name === 'ValidationError') {
          writeResponse(res, { message: err.message }, 401)
        } else if (err.name === 'BadPathError') {
          writeResponse(res, { message: err.message }, 403)
        } else if (err.name === 'NotEnoughProofError') {
          writeResponse(res, { message: err.message }, 402)
        } else {
          writeResponse(res, { message: 'Server Error' }, 500)
        }
      })
  })

  app.post(
      /^\/list-files\/([a-zA-Z0-9]+)\/?/, express.json(),
    (req: express.request, res: express.response) => {
      // sanity check...
      if (req.headers['content-length'] > 4096) {
        writeResponse(res, { mesasge: 'Invalid JSON: too long'}, 400)
        return
      }

      const address = req.params[0]
      const requestBody = req.body
      const page = requestBody.page ? requestBody.page : null

      server.handleListFiles(address, page, req.headers)
        .then((files) => {
          writeResponse(res, { entries: files.entries, page: files.page }, 202)
        })
        .catch((err) => {
          logger.error(err)
          if (err.name === 'ValidationError') {
            writeResponse(res, { message: err.message }, 401)
          } else {
            writeResponse(res, { message: 'Server Error' }, 500)
          }
        })
    })

  app.get('/hub_info/', (req: express.request,
                         res: express.response) => {
                           const challengeText = getChallengeText(server.serverName)
    if (challengeText.length < 10) {
      return writeResponse(res, { message: 'Server challenge text misconfigured' }, 500)
    }
    const readURLPrefix = server.getReadURLPrefix()
    writeResponse(res, { 'challenge_text': challengeText,
                         'latest_auth_version': LATEST_AUTH_VERSION,
                         'read_url_prefix': readURLPrefix }, 200)
  })

  // Instantiate express application
  return app
}
