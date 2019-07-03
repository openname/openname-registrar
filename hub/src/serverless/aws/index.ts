'use strict'

import { APIGatewayProxyEvent } from 'aws-lambda'
import AWS from 'aws-sdk'
import { HubServer } from '../../server/server'
import { getConfig } from '../../server/config'
import S3Driver, { S3_CONFIG_TYPE } from '../../server/drivers/S3Driver'
import { ProofChecker } from '../../server/ProofChecker'
import * as errors from '../../server/errors'
import { Readable } from 'stream'
import { getChallengeText, LATEST_AUTH_VERSION } from '../../server/authentication'

let hubServer: HubServer = undefined

module.exports.handleRequest = async (event: APIGatewayProxyEvent) => {

  try {
    hubServer = await buildHubServer()
  } catch (err) {
    return writeResponse({ message: err.message, error: err.name }, 500)
  }

  // Extract address from path
  let match = event.path.match(/\/store\/([a-zA-Z0-9]+)\//)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: address missing' }, 422)
  }
  const address = match[match.length - 1]

  // Extract filename from path
  match = event.path.match(/\/store\/[a-zA-Z0-9]+\/([^\/]+)/)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: filename missing' }, 422)
  }
  const filename = match[match.length - 1]

  const headers = {
    contentType: event.headers['Content-Type'],
    contentLength: event.headers['Content-Length'],
    authorization: event.headers['Authorization']
  }

  const buffer = new Buffer(event.body, 'base64')
  const stream = new Readable()
  stream._read = () => {}
  stream.push(buffer)
  stream.push(null)

  try {
    const publicURL = await hubServer.handleRequest(address, filename, headers, stream)
    return writeResponse({ publicURL }, 202)
  } catch (err) {
    if (err instanceof errors.ValidationError) {
      return writeResponse({ message: err.message, error: err.name }, 401)
    } else if (err instanceof errors.AuthTokenTimestampValidationError) {
      return writeResponse({ message: err.message, error: err.name  }, 401)
    } else if (err instanceof errors.BadPathError) {
      return writeResponse({ message: err.message, error: err.name  }, 403)
    } else if (err instanceof errors.NotEnoughProofError) {
      return writeResponse({ message: err.message, error: err.name  }, 402)
    } else if (err instanceof errors.ConflictError) {
      return writeResponse({ message: err.message, error: err.name  }, 409)
    } else {
      return writeResponse({ message: 'Server Error' }, 500)
    }
  }
}

module.exports.handleDelete = async (event: APIGatewayProxyEvent) => {

  try {
    hubServer = await buildHubServer()
  } catch (err) {
    return writeResponse({ message: err.message, error: err.name }, 500)
  }

  // Extract address from path
  let match = event.path.match(/\/delete\/([a-zA-Z0-9]+)\//)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: address missing' }, 422)
  }
  const address = match[match.length - 1]

  // Extract filename from path
  match = event.path.match(/\/delete\/[a-zA-Z0-9]+\/([^\/]+)/)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: filename missing' }, 422)
  }
  const filename = match[match.length - 1]

  const headers = {
    contentType: event.headers['Content-Type'],
    contentLength: event.headers['Content-Length'],
    authorization: event.headers['Authorization']
  }

  // Sanity checks
  if (address === null || filename === null) {
    return writeResponse({ message: 'Unprocessable entity: address of filename missing' }, 422)
  }

  try {
    await hubServer.handleDelete(address, filename, headers)
    return writeResponse({}, 202)
  } catch (err) {
    if (err instanceof errors.ValidationError) {
      return writeResponse({ message: err.message, error: err.name }, 401)
    } else if (err instanceof errors.AuthTokenTimestampValidationError) {
      return writeResponse({ message: err.message, error: err.name  }, 401)
    } else if (err instanceof errors.BadPathError) {
      return writeResponse({ message: err.message, error: err.name  }, 400)
    } else if (err instanceof errors.DoesNotExist) {
      return writeResponse({ message: err.message, error: err.name  }, 404)
    } else if (err instanceof errors.NotEnoughProofError) {
      return writeResponse({ message: err.message, error: err.name  }, 402)
    } else {
      return writeResponse({ message: 'Server Error' }, 500)
    }
  }
}

module.exports.handleListFiles = async (event: APIGatewayProxyEvent) => {

  try {
    hubServer = await buildHubServer()
  } catch (err) {
    return writeResponse({ message: err.message, error: err.name }, 500)
  }
  
  const match = event.path.match(/^\/list-files\/([a-zA-Z0-9]+)\/?/)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: address missing' }, 422)
  }
  const address = match[match.length - 1]

  const headers = {
    contentType: event.headers['Content-Type'],
    contentLength: event.headers['Content-Length'],
    authorization: event.headers['Authorization']
  }

  const body = JSON.parse(event.body)
  const page = body && body.page ? body.page : null

  // Sanity checks
  if (parseInt(headers.contentLength) > 4096) {
    return writeResponse({ message: 'Invalid JSON: too long'}, 400)
  }

  try {
    const files = await hubServer.handleListFiles(address, page, headers)
    return writeResponse({ entries: files.entries, page: files.page }, 202)
  } catch (err) {
    if (err instanceof errors.ValidationError) {
      return writeResponse({ message: err.message, error: err.name }, 401)
    } else if (err instanceof errors.AuthTokenTimestampValidationError) {
      return writeResponse({ message: err.message, error: err.name  }, 401)
    } else {
      return writeResponse({ message: 'Server Error' }, 500)
    }
  }
}

module.exports.handleAuthBump = async (event: APIGatewayProxyEvent) => {

  try {
    hubServer = await buildHubServer()
  } catch (err) {
    return writeResponse({ message: err.message, error: err.name }, 500)
  }
  
  const headers = {
    contentType: event.headers['Content-Type'],
    contentLength: event.headers['Content-Length'],
    authorization: event.headers['Authorization']
  }

  // Sanity checks
  if (parseInt(headers.contentLength) > 4096) {
    return writeResponse({ message: 'Invalid JSON: too long'}, 400)
  }

  const body = JSON.parse(event.body)

  if (!body && !body.oldestValidTimestamp) {
    return writeResponse({ message: 'Invalid JSON: missing oldestValidTimestamp'}, 400)
  }

  const match = event.path.match(/^\/list-files\/([a-zA-Z0-9]+)\/?/)
  if (!match) {
    return writeResponse({ message: 'Unprocessable entity: address missing' }, 422)
  }
  const address = match[match.length - 1]

  const oldestValidTimestamp: number = parseInt(body.oldestValidTimestamp)

  if (!Number.isFinite(oldestValidTimestamp) || oldestValidTimestamp < 0) {
    writeResponse({ message: 'Invalid JSON: oldestValidTimestamp is not a valid integer'}, 400)
    return
  }

  try {
    await hubServer.handleAuthBump(address, oldestValidTimestamp, headers)
    return writeResponse({ status: 'success' }, 202)
  } catch (err) {
    if (err instanceof errors.ValidationError) {
      return writeResponse({ message: err.message, error: err.name  }, 401)
    } else if (err instanceof errors.BadPathError) {
      return writeResponse({ message: err.message, error: err.name  }, 403)
    } else {
      return writeResponse({ message: 'Server Error' }, 500)
    }
  }
}

module.exports.handleHubInfo = async (_: APIGatewayProxyEvent) => {

  try {
    hubServer = await buildHubServer()
  } catch (err) {
    return writeResponse({ message: err.message, error: err.name }, 500)
  }
  
  const challengeText = getChallengeText(hubServer.serverName)
  if (challengeText.length < 10) {
    return writeResponse({ message: 'Server challenge text misconfigured' }, 500)
  }
  const readURLPrefix = hubServer.getReadURLPrefix()
  return writeResponse({
    'challenge_text': challengeText,
    'latest_auth_version': LATEST_AUTH_VERSION,
    'read_url_prefix': readURLPrefix }, 200)
}

const buildHubServer = async (): Promise<HubServer> => {
  
  if (hubServer !== undefined) {
    return hubServer
  } 

  const config = getConfig()

  let gaiaServerName = process.env.GAIA_SERVER_NAME
  if (gaiaServerName === undefined || gaiaServerName === '') {
    // A bug / limitation with AWS SAM makes the creation of an env var GAIA_SERVER_NAME impossible.
    // As a consequence, when gaia is being deployed via AWS Lambda Marketplace / SAM,
    // We fallback on fetching GAIA_SERVER_NAME from a parameter store.
    const ssm = new AWS.SSM()
    const params = {
      Name: `/${process.env.HUB_NAME}/${process.env.GAIA_BUCKET_NAME}/GAIA_SERVER_NAME`,
      WithDecryption: false
    }

    const req = await ssm.getParameter(params).promise()
    if (!req.$response.data || req.$response.error !== null) {
      throw 'Unable to fetch the Parameter Store'
    }

    gaiaServerName = req.Parameter.Value
    if (gaiaServerName === undefined || gaiaServerName === '') {
      throw 'Unable to retrieve GAIA_SERVER_NAME'
    }
  }

  config.serverName = gaiaServerName
  config.bucket = process.env.GAIA_BUCKET_NAME
  config.readURL = process.env.GAIA_READ_URL

  // We set shouldCheckStorage to false in order to avoid asynchronism and potential race conditions
  // on a lambda cold starting.
  // The request will return a 4xx/5xx anyway if the storage can't be reached.
  const driver = new S3Driver(config as S3_CONFIG_TYPE, false)
  
  driver.ensureInitialized().catch((error) => {
    throw `Error initializing driver ${error}`
  })

  const proofChecker = new ProofChecker(config.proofsConfig)
  hubServer = new HubServer(driver, proofChecker, config)
  return hubServer
}

const writeResponse = (data: any, statusCode: number) => {
  return {
    statusCode: statusCode,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data, null, 2)  
  }
}
