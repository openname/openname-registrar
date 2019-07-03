import S3 from 'aws-sdk/clients/s3'

import { BadPathError, InvalidInputError, DoesNotExist } from '../errors'
import { ListFilesResult, PerformWriteArgs, PerformDeleteArgs } from '../driverModel'
import { DriverStatics, DriverModel, DriverModelTestMethods } from '../driverModel'
import { timeout, logger } from '../utils'

export interface S3_CONFIG_TYPE {
  awsCredentials: {
    accessKeyId?: string,
    secretAccessKey?: string,
    sessionToken?: string,
    endpoint?: string
  },
  pageSize?: number,
  cacheControl?: string,
  bucket: string
}

class S3Driver implements DriverModel, DriverModelTestMethods {
  s3: S3
  endpoint: string
  bucket: string
  pageSize: number
  cacheControl?: string
  initPromise: Promise<void>

  static getConfigInformation() {
    const envVars: any = {}
    const awsCredentials: any = {}
    if (process.env['GAIA_S3_ACCESS_KEY_ID']) {
      awsCredentials['accessKeyId'] = process.env['GAIA_S3_ACCESS_KEY_ID']
      envVars['awsCredentials'] = awsCredentials
    }
    if (process.env['GAIA_S3_SECRET_ACCESS_KEY']) {
      awsCredentials['secretAccessKey'] = process.env['GAIA_S3_SECRET_ACCESS_KEY']
      envVars['awsCredentials'] = awsCredentials
    }
    if (process.env['GAIA_S3_SESSION_TOKEN']) {
      awsCredentials['sessionToken'] = process.env['GAIA_S3_SESSION_TOKEN']
      envVars['awsCredentials'] = awsCredentials
    }

    return {
      defaults: { awsCredentials: <any>undefined },
      envVars
    }
  }

  constructor (config: S3_CONFIG_TYPE, shouldCheckStorage: boolean = true) {
    if (config.awsCredentials && config.awsCredentials.endpoint) {
      this.endpoint = config.awsCredentials.endpoint
    } else {
      this.endpoint = 's3.amazonaws.com'
    }
    this.s3 = new S3(config.awsCredentials)
    this.bucket = config.bucket
    this.pageSize = config.pageSize ? config.pageSize : 100
    this.cacheControl = config.cacheControl
    if (shouldCheckStorage) {
      this.initPromise = this.createIfNeeded()
    } else {
      this.initPromise = Promise.resolve()
    }
  }

  ensureInitialized() {
    return this.initPromise
  }

  dispose() {
    return Promise.resolve()
  }

  static isPathValid(path: string){
    // for now, only disallow double dots.
    return (path.indexOf('..') === -1)
  }

  getReadURLPrefix(): string {
    return `https://${this.bucket}.${this.endpoint}/`
  }

  async createIfNeeded () {
    const bucketExists = await this.s3BucketExists()
    if (!bucketExists) {
      const params = {
        Bucket: this.bucket,
        ACL: 'public-read'
      }
      try {
        await this.s3.createBucket(params).promise()
        // Bucket creation takes a bit to propagate through AWS
        // infrastructure before it is available for use. 
        while (!(await this.s3BucketExists())) {
          await timeout(500)
        }
        logger.info(`initialized s3 bucket: ${this.bucket}`)
      } catch (error) {
        /* istanbul ignore next */
        logger.error(`failed to initialize s3 bucket: ${error}`)
        /* istanbul ignore next */
        throw error
      }
    }
  }

  async s3BucketExists() {
    try {
      await this.s3.headBucket({ Bucket: this.bucket }).promise()
      return true
    } catch (error) {
      if (['NoSuchBucket', 'NotFound'].includes(error.code)) {
        return false
      }
      /* istanbul ignore next */
      logger.error(`Unexpected error while checking if bucket exists: ${error}`)
      /* istanbul ignore next */
      throw error
    }
  }

  async deleteEmptyBucket() {
    const files = await this.listFiles('')
    if (files.entries.length > 0) {
      /* istanbul ignore next */
      throw new Error('Tried deleting non-empty bucket')
    }
    await this.s3.deleteBucket({ Bucket: this.bucket }).promise()
  }

  async listAllKeys(prefix: string, page?: string): Promise<ListFilesResult> {
    // returns {'entries': [...], 'page': next_page}
    const opts: S3.ListObjectsRequest = {
      Bucket: this.bucket,
      MaxKeys: this.pageSize,
      Prefix: prefix
    }
    if (page) {
      opts.Marker = page
    }
    const data = await this.s3.listObjects(opts).promise()
    const res: ListFilesResult = {
      entries: data.Contents.map((e) => e.Key.slice(prefix.length + 1)),
      page: data.IsTruncated ? data.NextMarker : null
    }
    /**
     * "If the response does not include the NextMarker and it is truncated, you 
     *  can use the value of the last Key in the response as the marker in the 
     *  subsequent request to get the next set of object keys."
     * @see https://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
     */
    if (data.IsTruncated && !res.page && data.Contents.length > 0) {
      res.page = data.Contents[data.Contents.length - 1].Key
    }
    return res
  }

  listFiles(prefix: string, page?: string) {
    // returns {'entries': [...], 'page': next_page}
    return this.listAllKeys(prefix, page)
  }

  async performWrite(args: PerformWriteArgs): Promise<string> {
    if (args.contentType && args.contentType.length > 1024) {
      throw new InvalidInputError('Invalid content-type')
    }
    if (!S3Driver.isPathValid(args.path)){
      throw new BadPathError('Invalid Path')
    }

    const s3key = `${args.storageTopLevel}/${args.path}`
    const s3params: S3.Types.PutObjectRequest = {
      Bucket: this.bucket,
      Key: s3key,
      Body: args.stream,
      ContentType: args.contentType,
      ACL: 'public-read'
    }
    if (this.cacheControl) {
      s3params.CacheControl = this.cacheControl
    }

    // Upload stream to s3
    try {
      await this.s3.upload(s3params).promise()
    } catch (error) {
      logger.error(`failed to store ${s3key} in bucket ${this.bucket}`)
      throw new Error('S3 storage failure: failed to store' +
        ` ${s3key} in bucket ${this.bucket}: ${error}`)
    }

    const publicURL = `${this.getReadURLPrefix()}${s3key}`
    logger.debug(`storing ${s3key} in bucket ${this.bucket}`)
    return publicURL
  }

  async performDelete(args: PerformDeleteArgs): Promise<void> {
    if (!S3Driver.isPathValid(args.path)){
      throw new BadPathError('Invalid Path')
    }
    const s3key = `${args.storageTopLevel}/${args.path}`
    const s3params: S3.Types.DeleteObjectRequest & S3.Types.HeadObjectRequest = {
      Bucket: this.bucket,
      Key: s3key
    }

    // S3 does not return an error if file does not exist, yet still writes a delete marker.
    // So first check if the file exists using `headObject` which throws 404. 
    // https://stackoverflow.com/a/53530749/794962
    try {
      await this.s3.headObject(s3params).promise()
      await this.s3.deleteObject(s3params).promise()
    } catch (error) {
      if (error.statusCode === 404) {
        throw new DoesNotExist('File does not exist')
      }
      /* istanbul ignore next */
      logger.error(`failed to delete ${s3key} in bucket ${this.bucket}`)
      /* istanbul ignore next */
      throw new Error('S3 storage failure: failed to delete' +
        ` ${s3key} in bucket ${this.bucket}: ${error}`)
    }
  }

}

const driver: typeof S3Driver & DriverStatics = S3Driver
export default driver
