import test from 'tape-promise/tape'
import * as auth from '../../src/server/authentication'
import * as errors from '../../src/server/errors'
import { HubServer }  from '../../src/server/server'
import { ProofChecker } from '../../src/server/ProofChecker'
import { Readable } from 'stream'
import { DriverModel } from '../../src/server/driverModel'
import { ListFilesResult } from '../../src/server/driverModel'
import { InMemoryDriver } from './testDrivers/InMemoryDriver'
import { testPairs, testAddrs, createTestKeys } from './common'
import { MockAuthTimestampCache } from './MockAuthTimestampCache'
import * as integrationTestDrivers from './testDrivers/integrationTestDrivers'

const TEST_SERVER_NAME = 'test-server'
const TEST_AUTH_CACHE_SIZE = 10

class MockProofs extends ProofChecker {
  checkProofs() {
    return Promise.resolve(true)
  }
}

async function usingIntegrationDrivers(func: (driver: DriverModel, name: string) => Promise<any> | void) {
  for (const name in integrationTestDrivers.availableDrivers) {
    const driverInfo = integrationTestDrivers.availableDrivers[name];
    const driver = await driverInfo.create();
    try {
      await driver.ensureInitialized();
      await Promise.resolve(func(driver, name));
    }
    finally {
      await driver.dispose();
    }
  }
}

async function usingMemoryDriver(func: (driver: InMemoryDriver) => Promise<any> | void) {
  const driver = await InMemoryDriver.spawn()
  try {
    await Promise.resolve(func(driver))
  } finally {
    await driver.dispose()
  }
}

export function testServer() {
  test('validation tests', async (t) => {
    await usingIntegrationDrivers((mockDriver, name) => {
      t.comment(`testing driver: ${name}`);

      const { testPairs, testAddrs } = createTestKeys(2);
      const server = new HubServer(mockDriver, new MockProofs(),
                                  { serverName: TEST_SERVER_NAME, whitelist: [testAddrs[0]],
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      const authPart0 = auth.LegacyAuthentication.makeAuthPart(testPairs[1], challengeText)
      const auth0 = `bearer ${authPart0}`

      t.throws(() => server.validate(testAddrs[1], { authorization: auth0 }),
              errors.ValidationError, 'Non-whitelisted address should fail validation')
      t.throws(() => server.validate(testAddrs[0], {}),
              errors.ValidationError, 'Bad request headers should fail validation')

      const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
      const authorization = `bearer ${authPart}`
      try {
        server.validate(testAddrs[0], { authorization })
        t.pass('White-listed address with good auth header should pass')
      } catch (err) {
        t.fail('White-listed address with good auth header should pass')
      }

      try {
        server.validate(testAddrs[1], { authorization })
        t.fail('Non white-listed address with good auth header should fail')
      } catch (err) {
        t.pass('Non white-listed address with good auth header should fail')
      }
    })
  })

  test('validation with huburl tests', async (t) => {
    await usingIntegrationDrivers((mockDriver, name) => {
      t.comment(`testing driver: ${name}`);

      const { testPairs, testAddrs } = createTestKeys(2);
      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], requireCorrectHubUrl: true,
                                    serverName: TEST_SERVER_NAME, validHubUrls: ['https://testserver.com'],
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })

      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

      const authPartGood1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'https://testserver.com/')
      const authPartGood2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'https://testserver.com')
      const authPartBad1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined)
      const authPartBad2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'testserver.com')

      t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad1}` }),
              errors.ValidationError, 'Auth must include a hubUrl')
      t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad2}` }),
              errors.ValidationError, 'Auth must include correct hubUrl')

      try {
        server.validate(testAddrs[0], { authorization: `bearer ${authPartGood1}` })
        t.pass('Address with good auth header should pass')
      } catch (err) {
        t.fail('Address with good auth header should pass')
      }
      try {
        server.validate(testAddrs[0], { authorization: `bearer ${authPartGood2}` })
        t.pass('Address with good auth header should pass')
      } catch (err) {
        t.fail('Address with good auth header should pass')
      }
    })

  })

  test('validation with 2018 challenge texts', async (t) => {
    t.plan(5)
    await usingMemoryDriver(mockDriver => {
      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], requireCorrectHubUrl: true,
                                    serverName: TEST_SERVER_NAME, validHubUrls: ['https://testserver.com'],
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })

      const challengeTexts = []
      challengeTexts.push(auth.getChallengeText(TEST_SERVER_NAME))
      auth.getLegacyChallengeTexts(TEST_SERVER_NAME).forEach(challengeText => challengeTexts.push(challengeText))

      const challenge2018 = challengeTexts.find(x => x.indexOf('2018') > 0)
      t.ok(challenge2018, 'Should find a valid 2018 challenge text')

      const authPartGood1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'https://testserver.com/')
      const authPartGood2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'https://testserver.com')
      const authPartBad1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, undefined)
      const authPartBad2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'testserver.com')

      t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad1}` }),
              errors.ValidationError, 'Auth must include a hubUrl')
      t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad2}` }),
              errors.ValidationError, 'Auth must include correct hubUrl')

      try {
        server.validate(testAddrs[0], { authorization: `bearer ${authPartGood1}` })
        t.pass('Address with good auth header should pass')
      } catch (err) {
        t.fail('Address with good auth header should pass')
      }
      try {
        server.validate(testAddrs[0], { authorization: `bearer ${authPartGood2}` })
        t.pass('Address with good auth header should pass')
      } catch (err) {
        t.fail('Address with good auth header should pass')
      }
    })
  })

  test('handle request with readURL', async (t) => {
    t.plan(8)
    await usingMemoryDriver(mockDriver => {
      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], readURL: 'http://potato.com/',
                                    serverName: TEST_SERVER_NAME, authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      server.authTimestampCache = new MockAuthTimestampCache()
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
      const authorization = `bearer ${authPart}`

      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)

      return server.handleRequest(testAddrs[0], 'foo.txt',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(path => {
          t.equal(path, `http://potato.com/${testAddrs[0]}/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'text/text')
        })
        .then(() => server.handleRequest(testAddrs[0], 'foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(path => {
          t.equal(path, `http://potato.com/${testAddrs[0]}/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
        })
    })
  })

  test('handle request', async (t) => {
    await usingMemoryDriver(async (mockDriver) => {
      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
      const authorization = `bearer ${authPart}`

      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)

      await server.handleRequest(testAddrs[0], 'foo.txt',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(path => {
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'text/text')
        })
        .then(() => server.handleRequest(testAddrs[0], 'foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(path => {
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
        })

      await server.handleDelete(testAddrs[0], 'foo.txt', { authorization })
        .then(() => {
          t.pass('delete foo.txt')
        })
    })
  })

  test('auth token timeout cache monitoring', async (t) => {
    await usingMemoryDriver(async (mockDriver) => {
      const server = new HubServer(mockDriver, new MockProofs(), {
                                    serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: 4})
      const getJunkData = () => {
        const s = new Readable()
        s.push('hello world')
        s.push(null)
        return s
      }

      for (let i = 0; i < 10; i++) {
        const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
        let authPart = auth.V1Authentication.makeAuthPart(testPairs[i], challengeText)
        let authorization = `bearer ${authPart}`
        for (let f = 0; f < 3; f++) {
          await server.handleRequest(testAddrs[i], '/foo/bar', 
                                    { contentType: 'text/text',
                                      contentLength: 400,
                                      authorization }, getJunkData())
        }
      }

      t.equal(server.authTimestampCache.currentCacheEvictions, 6, 'Auth cache should have correct number of evictions')
      t.equal(server.authTimestampCache.cache.itemCount, 4, 'Auth cache should have correct item count')
      server.authTimestampCache.setupCacheEvictionLogger(1)
      await new Promise((res) => setTimeout(() => res(), 10))
      t.equal(server.authTimestampCache.currentCacheEvictions, 0, 'Auth cache eviction count should have been cleared by logger')
    })
  })

  test('fail writes with auth token fetch errors', async (t) => {
    await usingMemoryDriver(async (driver) => {

      const testPath = `/${Date.now()}/${Math.random()}`;
      const { testPairs, testAddrs } = createTestKeys(2);

      const server = new HubServer(driver, new MockProofs(), {
                                    serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE})
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      let authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText)
      let authorization = `bearer ${authPart}`

      const getJunkData = () => {
        const s = new Readable()
        s.push('hello world')
        s.push(null)
        return s
      }
      
      // simulate a hub driver endpoint being offline during the auth token fetch
      server.authTimestampCache.readUrlPrefix = 'http://unreachable.local/'

      // no revocation timestamp has been set, but the write should still fail
      // since the revocation token cannot be retrieved (or 404ed) from the driver
      // read endpoint. 
      await t.rejects(server.handleRequest(testAddrs[0], testPath,
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, getJunkData()), errors.ValidationError, 'write with auth token failing to fetch should fail')

    })
  })

  test('fail writes with revoked auth token', async (t) => {
    await usingIntegrationDrivers(async (mockDriver, name) => {
      t.comment(`testing driver: ${name}`);

      const testPath = `/${Date.now()}/${Math.random()}`;
      const { testPairs, testAddrs } = createTestKeys(2);

      const server = new HubServer(mockDriver, new MockProofs(), {
                                    serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE})
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      let authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText)
      let authorization = `bearer ${authPart}`

      const getJunkData = () => {
        const s = new Readable()
        s.push('hello world')
        s.push(null)
        return s
      }

      // no revocation timestamp has been set, write request should succeed
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())

      // revoke the auth token (setting oldest valid date into the future)
      const futureDate = (Date.now()/1000|0) + 10000
      await server.handleAuthBump(testAddrs[0], futureDate, { authorization })

      // write should fail with auth token creation date older than the revocation date 
      await t.rejects(server.handleRequest(testAddrs[0], testPath,
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, getJunkData()), errors.AuthTokenTimestampValidationError, 'write with revoked auth token should fail')

      // simulate auth token being dropped from cache and ensure it gets re-fetched
      server.authTimestampCache.cache.reset()
      await t.rejects(server.handleRequest(testAddrs[0], testPath,
        { contentType: 'text/text',
          contentLength: 400,
          authorization }, getJunkData()), errors.AuthTokenTimestampValidationError, 'write with revoked auth token should fail if not in cache')

      // create a auth token with iat forced further into the future
      authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined, undefined, futureDate + 10000)
      authorization = `bearer ${authPart}`
    
      // request should succeed with a token iat newer than the revocation date
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())

      // simulate auth token being dropped from cache and ensure it gets re-fetched
      server.authTimestampCache.cache.reset()

      // request should still succeed after re-fetching to populate cache
      await server.handleRequest(testAddrs[0], testPath, 
        { contentType: 'text/text',
          contentLength: 400,
          authorization }, getJunkData())
    })
  })

  test('non-whitelisted address can bump revocation if bearing valid association token', async (t) => {
    await usingIntegrationDrivers(async (mockDriver, name) => {
      t.comment(`testing driver: ${name}`);

      const testPath = `/${Date.now()}/${Math.random()}`;
      const { testPairs, testAddrs } = createTestKeys(2);

      const server = new HubServer(mockDriver, new MockProofs(), {
                                    serverName: TEST_SERVER_NAME,
                                    whitelist: [testAddrs[1]],
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE})

      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      const associationToken = auth.V1Authentication.makeAssociationToken(testPairs[1], testPairs[0].publicKey.toString('hex'))
      let authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, associationToken)
      let authorization = `bearer ${authPart}`

      const getJunkData = () => {
        const s = new Readable()
        s.push('hello world')
        s.push(null)
        return s
      }

      // no revocation timestamp has been set, write request should succeed
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())

      // revoke the auth token (setting oldest valid date into the future)
      const futureDate = (Date.now()/1000|0) + 10000
      await server.handleAuthBump(testAddrs[0], futureDate, { authorization })

      // write should fail with auth token creation date older than the revocation date 
      await t.rejects(server.handleRequest(testAddrs[0], testPath,
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, getJunkData()), errors.AuthTokenTimestampValidationError, 'write with revoked auth token should fail')

      // sanity test to make sure writing to any given address still fails from a regular validation error
      await t.rejects(server.handleRequest(testAddrs[4], testPath,
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, getJunkData()), errors.ValidationError, 'write with revoked auth token should fail')

      // create a auth token with iat forced further into the future
      authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, associationToken, undefined, undefined, futureDate + 10000)
      authorization = `bearer ${authPart}`
    
      // request should succeed with a token iat newer than the revocation date
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())
    })
  })

  test('auth token bearer can only bump the address of its signer', async (t) => {

    await usingIntegrationDrivers(async (mockDriver, name) => {
      
      t.comment(`testing driver: ${name}`);

      const testPath = `/${Date.now()}/${Math.random()}`;
      const { testPairs, testAddrs } = createTestKeys(2);

      const server = new HubServer(mockDriver, new MockProofs(), {
                                    serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE})
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
      let authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText)
      let authorization = `bearer ${authPart}`

      const getJunkData = () => {
        const s = new Readable()
        s.push('hello world')
        s.push(null)
        return s
      }

      // no revocation timestamp has been set, write request should succeed
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())

      // attempting to bump an address other than the signer should fail
      await t.rejects(
        server.handleAuthBump(testAddrs[1], (Date.now()/1000|0) + 10000, { authorization }), 
        errors.ValidationError, 
        'auth token bearer should only be able to bump the address of its signer')

      // confirm that bump failed and that write still succeeds
      await server.handleRequest(testAddrs[0], testPath, 
                                { contentType: 'text/text',
                                  contentLength: 400,
                                  authorization }, getJunkData())
    })
  })

  test('handle scoped deletes', async (t) => {
    await usingMemoryDriver(mockDriver => {
      const scopes = [
        {
          scope: 'deleteFile',
          domain: '/foo/bar',
        },
        {
          scope: 'deleteFilePrefix',
          domain: 'baz'
        },
        {
          scope: 'putFile',
          domain: '/foo/bar',
        },
        {
          scope: 'putFilePrefix',
          domain: 'baz'
        }
      ]

      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

      const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined, scopes)

      const authorization = `bearer ${authPart}`
      const authenticator = auth.parseAuthHeader(authorization)
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
              errors.ValidationError, 'Wrong address must throw')
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
              errors.ValidationError, 'Wrong challenge text must throw')
      t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
          'Good signature must pass')

      // scopes must be present
      const authScopes = authenticator.getAuthenticationScopes()
      t.equal(authScopes[0].scope, 'deleteFile', 'scope 0 is deletefile')
      t.equal(authScopes[0].domain, '/foo/bar', 'scope 0 is for /foo/bar')
      t.equal(authScopes[1].scope, 'deleteFilePrefix', 'scope 1 is deleteFilePrefix')
      t.equal(authScopes[1].domain, 'baz', 'scope 1 is for baz')

      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)
      const s3 = new Readable()
      s3.push('hello world')
      s3.push(null)
      const s4 = new Readable()
      s4.push('hello world')
      s4.push(null)

      return server.handleRequest(testAddrs[0], '/foo/bar',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(() => server.handleDelete(testAddrs[0], '/foo/bar', { authorization }))
        .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(() => server.handleDelete(testAddrs[0], '/nope/foo.txt', { authorization }))
        .catch((e) => {
          t.throws(() => { throw e }, errors.ValidationError, 'invalid path prefix should fail')
        })
        .then(() => server.handleDelete(testAddrs[0], '/foo/bar/nope.txt', { authorization }))
        .catch((e) => {
          t.throws(() => { throw e }, errors.ValidationError, 'deleteFile does not allow prefixes')
          t.end()
        })
    })
  })
  
  test('handle scoped writes', async (t) => {
    await usingMemoryDriver(mockDriver => {
      const writeScopes = [
        {
          scope: 'putFile',
          domain: '/foo/bar',
        },
        {
          scope: 'putFilePrefix',
          domain: 'baz'
        }
      ]

      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[0]], serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

      const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined, writeScopes)

      console.log(`V1 storage validation: ${authPart}`)

      const authorization = `bearer ${authPart}`
      const authenticator = auth.parseAuthHeader(authorization)
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
              errors.ValidationError, 'Wrong address must throw')
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
              errors.ValidationError, 'Wrong challenge text must throw')
      t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
          'Good signature must pass')

      // scopes must be present
      const authScopes = authenticator.getAuthenticationScopes()
      t.equal(authScopes[0].scope, 'putFile', 'scope 0 is putfile')
      t.equal(authScopes[0].domain, '/foo/bar', 'scope 0 is for /foo/bar')
      t.equal(authScopes[1].scope, 'putFilePrefix', 'scope 1 is putFilePrefix')
      t.equal(authScopes[1].domain, 'baz', 'scope 1 is for baz')

      // write to /foo/bar or /baz will succeed
      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)
      const s3 = new Readable()
      s3.push('hello world')
      s3.push(null)
      const s4 = new Readable()
      s4.push('hello world')
      s4.push(null)

      return server.handleRequest(testAddrs[0], '/foo/bar',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(path => {
          // NOTE: the double-/ is *expected*
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}//foo/bar`)
          t.equal(mockDriver.lastWrite.path, '/foo/bar')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'text/text')
        })
        .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(path => {
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}/baz/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'baz/foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
        })
        .then(() => server.handleRequest(testAddrs[0], '/nope/foo.txt',
                          { contentLength: 400,
                            authorization }, s3))
        .catch((e) => {
          t.throws(() => { throw e }, errors.ValidationError, 'invalid path prefix should fail')
        })
        .then(() => server.handleRequest(testAddrs[0], '/foo/bar/nope.txt',
                                        { contentLength: 400,
                                        authorization }, s4))
        .catch((e) => {
          t.throws(() => { throw e }, errors.ValidationError, 'putFile does not allow prefixes')
          t.end()
        })
    })
  })


  test('handle scoped deletes with association tokens', async (t) => {
    await usingMemoryDriver(mockDriver => {
      const scopes = [
        {
          scope: 'deleteFile',
          domain: '/foo/bar',
        },
        {
          scope: 'deleteFilePrefix',
          domain: 'baz'
        },
        {
          scope: 'putFile',
          domain: '/foo/bar',
        },
        {
          scope: 'putFilePrefix',
          domain: 'baz'
        }
      ]

      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[1]], serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

      const associationToken = auth.V1Authentication.makeAssociationToken(testPairs[1], testPairs[0].publicKey.toString('hex'))
      const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, associationToken, undefined, scopes)

      const authorization = `bearer ${authPart}`
      const authenticator = auth.parseAuthHeader(authorization)
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
              errors.ValidationError, 'Wrong address must throw')
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
              errors.ValidationError, 'Wrong challenge text must throw')
      t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
          'Good signature must pass')

      // write to /foo/bar or baz will succeed
      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)
      const s3 = new Readable()
      s3.push('hello world')
      s3.push(null)
      const s4 = new Readable()
      s4.push('hello world')
      s4.push(null)

      return server.handleRequest(testAddrs[0], '/foo/bar',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(() => server.handleDelete(testAddrs[0], '/foo/bar', { authorization }))
        .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(() => server.handleDelete(testAddrs[0], 'baz/foo.txt', { authorization }))
        .then(() => server.handleDelete(testAddrs[0], '/nope/foo.txt', { authorization }))
        .catch((e: any) => {
          t.throws(() => { throw e }, errors.ValidationError, 'invalid prefix should fail')
        })
        .then(() => server.handleDelete(testAddrs[0], '/foo/bar/nope.txt', { authorization }))
        .catch((e: any) => {
          t.throws(() => { throw e }, errors.ValidationError, 'deleteFile does not permit prefixes')
          t.end()
        })
      })
  })

  test('handle scoped writes with association tokens', async (t) => {
    await usingMemoryDriver(mockDriver => {
      const writeScopes = [
        {
          scope: 'putFile',
          domain: '/foo/bar',
        },
        {
          scope: 'putFilePrefix',
          domain: 'baz'
        }
      ]

      const server = new HubServer(mockDriver, new MockProofs(),
                                  { whitelist: [testAddrs[1]], serverName: TEST_SERVER_NAME,
                                    authTimestampCacheSize: TEST_AUTH_CACHE_SIZE })
      const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

      const associationToken = auth.V1Authentication.makeAssociationToken(testPairs[1], testPairs[0].publicKey.toString('hex'))
      const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, associationToken, undefined, writeScopes)

      console.log(`V1 storage validation: ${authPart}`)

      const authorization = `bearer ${authPart}`
      const authenticator = auth.parseAuthHeader(authorization)
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
              errors.ValidationError, 'Wrong address must throw')
      t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
              errors.ValidationError, 'Wrong challenge text must throw')
      t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
          'Good signature must pass')

      // write to /foo/bar or baz will succeed
      const s = new Readable()
      s.push('hello world')
      s.push(null)
      const s2 = new Readable()
      s2.push('hello world')
      s2.push(null)
      const s3 = new Readable()
      s3.push('hello world')
      s3.push(null)
      const s4 = new Readable()
      s4.push('hello world')
      s4.push(null)

      return server.handleRequest(testAddrs[0], '/foo/bar',
                          { contentType: 'text/text',
                            contentLength: 400,
                            authorization }, s)
        .then(path => {
          // NOTE: the double-/ is *expected*
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}//foo/bar`)
          t.equal(mockDriver.lastWrite.path, '/foo/bar')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'text/text')
        })
        .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                          { contentLength: 400,
                            authorization }, s2))
        .then(path => {
          t.equal(path, `${mockDriver.readUrl}${testAddrs[0]}/baz/foo.txt`)
          t.equal(mockDriver.lastWrite.path, 'baz/foo.txt')
          t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
          t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
        })
        .then(() => server.handleRequest(testAddrs[0], '/nope/foo.txt',
                          { contentLength: 400,
                            authorization }, s3))
        .catch((e: any) => {
          t.throws(() => { throw e }, errors.ValidationError, 'invalid prefix should fail')
        })
        .then(() => server.handleRequest(testAddrs[0], '/foo/bar/nope.txt',
                          { contentLength: 400,
                            authorization }, s4 ))
        .catch((e: any) => {
          t.throws(() => { throw e }, errors.ValidationError, 'putFile does not permit prefixes')
          t.end()
        })
      })
  })
}
