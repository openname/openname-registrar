import express, {Request, Response} from 'express'
import expressWinston from 'express-winston'
import cors from 'cors'

import { ProofChecker } from './ProofChecker'
import { getChallengeText, LATEST_AUTH_VERSION } from './authentication'
import { HubServer } from './server'
import { getDriverClass, logger } from './utils'
import { DriverModel } from './driverModel'
import * as errors from './errors'
import { HubConfigInterface } from './config'

export function makeHttpServer(config: HubConfigInterface): { app: express.Application, server: HubServer, driver: DriverModel } {

  const writeResponse = (res: express.Response, data: any, statusCode: number) => {
    res.writeHead(statusCode, {'Content-Type' : 'application/json'})
    res.write(JSON.stringify(data))
    res.end()
  }

  const app: express.Application = express()

  // Handle driver configuration
  let driver: DriverModel

  if (config.driverInstance) {
    driver = config.driverInstance
  } else if (config.driverClass) {
    driver = new config.driverClass(config)
  } else if (config.driver) {
    const driverClass = getDriverClass(config.driver)
    driver = new driverClass(config)
  } else {
    throw new Error('Driver option not configured')
  }
  
  const proofChecker = new ProofChecker(config.proofsConfig)
  const server = new HubServer(driver, proofChecker, config)

  // Instantiate server logging with Winston
  app.use(expressWinston.logger({
    winstonInstance: logger }))
  app.use(cors())

  // Express doesn't like to capture slashes.
  // Regexes solve that problem
  app.post(/^\/store\/([a-zA-Z0-9]+)\/([^\/]+)/, async (
    req: Request,
    res: Response
  ) => {
    const address = req.params[0]
    const filename = req.params[1]
    const headers = {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      authorization: req.headers['authorization']
    }
  
    // Sanity checks
    if (address === null || filename === null) {
      writeResponse(res, { message: 'Unprocessable entity: address of filename missing' }, 422)
      return
    }
  
    try {
      const publicURL = await server.handleRequest(address, filename, headers, req)
      writeResponse(res, { publicURL }, 202)
    } catch (err) {
      logger.error(err)
      if (err instanceof errors.ValidationError) {
        writeResponse(res, { message: err.message, error: err.name }, 401)
      } else if (err instanceof errors.AuthTokenTimestampValidationError) {
        writeResponse(res, { message: err.message, error: err.name  }, 401)
      } else if (err instanceof errors.BadPathError) {
        writeResponse(res, { message: err.message, error: err.name  }, 403)
      } else if (err instanceof errors.NotEnoughProofError) {
        writeResponse(res, { message: err.message, error: err.name  }, 402)
      } else if (err instanceof errors.ConflictError) {
        writeResponse(res, { message: err.message, error: err.name  }, 409)
      } else {
        writeResponse(res, { message: 'Server Error' }, 500)
      }
    }
  })

  app.delete(/^\/delete\/([a-zA-Z0-9]+)\/([^\/]+)/, async (
    req: Request,
    res: Response
  ) => {
    const address = req.params[0]
    const filename = req.params[1]
    const headers = {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      authorization: req.headers['authorization']
    }
  
    // Sanity checks
    if (address === null || filename === null) {
      writeResponse(res, { message: 'Unprocessable entity: address of filename missing' }, 422)
      return
    }
  
    try {
      await server.handleDelete(address, filename, headers)
      res.writeHead(202)
      res.end()
    } catch (err) {
      logger.error(err)
      if (err instanceof errors.ValidationError) {
        writeResponse(res, { message: err.message, error: err.name }, 401)
      } else if (err instanceof errors.AuthTokenTimestampValidationError) {
        writeResponse(res, { message: err.message, error: err.name  }, 401)
      } else if (err instanceof errors.BadPathError) {
        writeResponse(res, { message: err.message, error: err.name  }, 400)
      } else if (err instanceof errors.DoesNotExist) {
        writeResponse(res, { message: err.message, error: err.name  }, 404)
      } else if (err instanceof errors.NotEnoughProofError) {
        writeResponse(res, { message: err.message, error: err.name  }, 402)
      } else {
        writeResponse(res, { message: 'Server Error' }, 500)
      }
    }
  })

  app.post(/^\/list-files\/([a-zA-Z0-9]+)\/?/, express.json(), async (
    req: Request, 
    res: Response
  ) => {
    const address = req.params[0]
    const headers = {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      authorization: req.headers['authorization']
    }
    const page = req.body && req.body.page ? req.body.page : null
  
    // Sanity checks
    if (parseInt(headers.contentLength) > 4096) {
      writeResponse(res, { message: 'Invalid JSON: too long'}, 400)
      return
    }
  
    try {
      const files = await server.handleListFiles(address, page, headers)
      writeResponse(res, { entries: files.entries, page: files.page }, 202)
    } catch (err) {
      logger.error(err)
      if (err instanceof errors.ValidationError) {
        writeResponse(res, { message: err.message, error: err.name }, 401)
      } else if (err instanceof errors.AuthTokenTimestampValidationError) {
        writeResponse(res, { message: err.message, error: err.name  }, 401)
      } else {
        writeResponse(res, { message: 'Server Error' }, 500)
      }
    }
  })

  app.post(/^\/revoke-all\/([a-zA-Z0-9]+)\/?/, express.json(), async (
    req: express.Request, 
    res: express.Response
  ) => {
    const headers = {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      authorization: req.headers['authorization']
    }
  
    // Sanity checks
    if (parseInt(headers.contentLength) > 4096) {
      writeResponse(res, { message: 'Invalid JSON: too long'}, 400)
      return
    }
  
    if (!req.body || !req.body.oldestValidTimestamp) {
      writeResponse(res, { message: 'Invalid JSON: missing oldestValidTimestamp'}, 400)
      return
    }
  
    const address = req.params[0]
    const oldestValidTimestamp: number = parseInt(req.body.oldestValidTimestamp)
  
    if (!Number.isFinite(oldestValidTimestamp) || oldestValidTimestamp < 0) {
      writeResponse(res, { message: 'Invalid JSON: oldestValidTimestamp is not a valid integer'}, 400)
      return
    }
  
    try {
      await server.handleAuthBump(address, oldestValidTimestamp, headers)
      writeResponse(res, { status: 'success' }, 202)
    } catch (err) {
      logger.error(err)
      if (err instanceof errors.ValidationError) {
        writeResponse(res, { message: err.message, error: err.name  }, 401)
      } else if (err instanceof errors.BadPathError) {
        writeResponse(res, { message: err.message, error: err.name  }, 403)
      } else {
        writeResponse(res, { message: 'Server Error' }, 500)
      }
    }
  })

  app.get('/hub_info/', async (
    req: Request,
    res: Response
  ) => {
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
  return { app, server, driver }
}
