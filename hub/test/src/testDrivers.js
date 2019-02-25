/* @flow */
import test from 'tape-promise/tape'
import proxyquire from 'proxyquire'
import FetchMock from 'fetch-mock'
import * as NodeFetch from 'node-fetch'

import fs from 'fs'
import path from 'path'
import os from 'os'

import { Readable, Writable } from 'stream'
import { InMemoryDriver } from './testDrivers/InMemoryDriver'
import { DriverModel } from '../../src/server/driverModel'
import type { ListFilesResult } from '../../src/server/driverModel'

import DiskDriver from '../../src/server/drivers/diskDriver'

import * as mockTestDrivers from './testDrivers/mockTestDrivers'
import * as integrationTestDrivers from './testDrivers/integrationTestDrivers'

export function addMockFetches(fetchLib: any, prefix: any, dataMap: any) {
  dataMap.forEach(item => {
    fetchLib.get(`${prefix}${item.key}`, item.data, { overwriteRoutes: true })
  })
}


function testDriver(testName: string, mockTest: boolean, dataMap: [], createDriver: () => DriverModel) {
  test(testName, async (t) => {
    const topLevelStorage = `${Date.now()}r${Math.random()*1e6|0}`
    const driver = createDriver()
    try {
      await driver.ensureInitialized()
      const prefix = driver.getReadURLPrefix()
      const sampleDataString = 'hello world'
      const getSampleData = () => {
        const contentBuff = Buffer.from(sampleDataString)
        const s = new Readable()
        s.push(contentBuff)
        s.push(null)
        return { stream: s, contentLength: contentBuff.length }
      }

      const fetch = mockTest ? FetchMock.sandbox(NodeFetch) : NodeFetch;

      try {
        const writeArgs : any = { path: '../foo.js'}
        await driver.performWrite(writeArgs)
        t.ok(false, 'Should have thrown')
      }
      catch (err) {
        t.equal(err.message, 'Invalid Path', 'Should throw bad path')
      }

      // Test binary data content-type
      const binFileName = 'somedir/foo.bin';
      let sampleData = getSampleData();
      let readUrl = await driver.performWrite({
        path: binFileName,
        storageTopLevel: topLevelStorage,
        stream: sampleData.stream,
        contentType: 'application/octet-stream',
        contentLength: sampleData.contentLength
      });
      t.ok(readUrl.startsWith(`${prefix}${topLevelStorage}`), `${readUrl} must start with readUrlPrefix ${prefix}${topLevelStorage}`)

      if (mockTest) {
        addMockFetches(fetch, prefix, dataMap)
      }

      let resp = await fetch(readUrl)
      t.ok(resp.ok, 'fetch should return 2xx OK status code')
      let resptxt = await resp.text()
      t.equal(resptxt, sampleDataString, `Must get back ${sampleDataString}: got back: ${resptxt}`)
      if (!mockTest) {
        t.equal(resp.headers.get('content-type'), 'application/octet-stream', 'Read-end point response should contain correct content-type')
      }

      let files = await driver.listFiles(topLevelStorage)
      t.equal(files.entries.length, 1, 'Should return one file')
      t.equal(files.entries[0], binFileName, `Should be ${binFileName}!`)


      // Test a text content-type that has implicit charset set
      const txtFileName = 'somedir/foo_text.txt';
      sampleData = getSampleData();
      readUrl = await driver.performWrite(
          { path: txtFileName,
            storageTopLevel: topLevelStorage,
            stream: sampleData.stream,
            contentType: 'text/plain; charset=utf-8',
            contentLength: sampleData.contentLength })
      t.ok(readUrl.startsWith(`${prefix}${topLevelStorage}`), `${readUrl} must start with readUrlPrefix ${prefix}${topLevelStorage}`)
      if (mockTest) {
        addMockFetches(fetch, prefix, dataMap)
      }

      resp = await fetch(readUrl)
      t.ok(resp.ok, 'fetch should return 2xx OK status code')
      resptxt = await resp.text()
      t.equal(resptxt, sampleDataString, `Must get back ${sampleDataString}: got back: ${resptxt}`)
      if (!mockTest) {
        t.equal(resp.headers.get('content-type'), 'text/plain; charset=utf-8', 'Read-end point response should contain correct content-type')
      }

      files = await driver.listFiles(topLevelStorage)
      t.equal(files.entries.length, 2, 'Should return two files')
      t.ok(files.entries.includes(txtFileName), `Should include ${txtFileName}`)

      if (mockTest) {
        fetch.restore()
      }
    }
    finally {
      await driver.dispose();
    }

  });
}

function testMockCloudDrivers() {
  for (const name in mockTestDrivers.availableMockedDrivers) {
    const testName = `mock test for driver: ${name}`
    const mockTest = true
    const { driverClass, dataMap, config } = mockTestDrivers.availableMockedDrivers[name]();
    testDriver(testName, mockTest, dataMap, () => new driverClass(config))
  }
}

function testRealCloudDrivers() {
  for (const name in integrationTestDrivers.availableDrivers) {
    const create = integrationTestDrivers.availableDrivers[name];
    const testName = `integration test for driver: ${name}`
    const mockTest = false
    testDriver(testName, mockTest, [], () => create())
  }
}

export function testDrivers() {
  testMockCloudDrivers()
  testRealCloudDrivers()
}
