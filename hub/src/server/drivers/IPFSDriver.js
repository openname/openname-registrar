import type {DriverModel} from '../driverModel'
import {Readable} from 'stream'
import ipfsAPI from 'ipfs-api'
import logger from 'winston'
import {BadPathError} from '../errors'

type IPFS_CONFIG_TYPE = {
  readURL: string,
  configuration: Object,
  providerReadUrl: string
}

class IPFSDriver implements DriverModel {
  ipfs: any
  readURL: string
  ipnsPath: string
  ipnsId: string

  constructor(config: IPFS_CONFIG_TYPE) {
    const { configuration, ipnsPath, peerKeyName, providerReadUrl } = config.ipfs
    if (!configuration || Object.keys(configuration).length === 0) {
      throw new Error('Config is missing for IPFS driver!')
    }

    if (IPFSDriver.isPathValid(providerReadUrl)) {
      throw new BadPathError('Invalid readProviderUrl path! Use without \'/\' at the end!')
    }

    if (IPFSDriver.isPathValid(ipnsPath)) {
      throw new BadPathError('Invalid ipnsPath path! Use without \'/\' at the end!')
    }

    this.readURL = providerReadUrl
    this.ipnsPath = ipnsPath
    this.ipfs = ipfsAPI(configuration)

    this.ipfs.version((error, version) => {
      if (error) {
        logger.error(`failed to check version of IPFS: ${error}`)
        throw new Error('Your IPFS daemon is down! Please check your daemon.')
      }

      logger.warn(version)

      this.ipfs.key.list((error, keys) => {
        if (error) throw new Error(`failed to load IPFS peer identity: ${error}`)

        if (keys.length) {
          const keyName = peerKeyName || 'self' // self key is created by default when you init IPFS
          const peerKey = this.getPeerKey(keys, keyName)

          if (!peerKey) {
            throw new Error('Invalid a peer key name!')
          }

          this.ipnsId = peerKey.id
        } else {
          throw new Error('Please generate peer key. Check IPFS documentation (https://ipfs.io/docs/commands/#ipfs-key-gen).')
        }
      })
    })
  }

  static isPathValid(path: string): string {
    if (path) {
      return path.slice(-1) === '/'
    }

    return false
  }

  getPeerKey(keys: Array, name: string): string {
    return keys.find(key => key.name === name)
  }

  publish(address: string): Promise {
    return new Promise(((resolve, reject) => {
      this.ipfs.name.publish(`/ipfs/${address}`, (error, response) => {
        if (error) return reject(error)
        return resolve(response.name)
      })
    }))
  }

  getReadURLPrefix(): string {
    const gateway = 'https://gateway.ipfs.io'
    return `${gateway}/ipns/${this.ipnsId}/`
  }

  performWrite(args: {
    path: string,
    storageTopLevel: string,
    stream: Readable,
    contentLength: number,
    contentType: string
  }): Promise<string> {
    const {storageTopLevel, stream, path} = args
    const filePath = `${this.ipnsPath}/${storageTopLevel}/${path}`

    return new Promise((resolve, reject) => {
      const files = [{
        path: filePath,
        content: stream
      }]

      this.ipfs.files.add(files, (error, files) => {
        if (error) {
          return reject(error)
        }
        const address = files.find(data => data.path === this.ipnsPath)
        // IPNS name publish is very slow and this is the reason why we don't wait publish to resolve
        // this is a know issue so we can improve this if we add flag when run our IPFS daemon
        // ipfs daemon --enable-namesys-pubsub
        // check the current issues on this topic
        // https://github.com/ipfs/go-ipfs/issues/2078,
        // https://github.com/ipfs/go-ipfs/issues/2105, etc.

        // code below will only write logs on the output
        this.publish(address.hash)
          .then((data) => logger.warn('Successfully published on IPNS with hash: ' + data))
          .catch(err => logger.error(err))

        return resolve(this.getReadURLPrefix())
      })
    })
  }
}

module.exports = IPFSDriver
