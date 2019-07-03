The rest of this will probably be refactored

# Running the Gaia Hub

To get started running a gaia hub, execute the following:

```bash
$ git clone https://github.com/blockstack/gaia.git
$ cd gaia/hub/
$ npm install
$ npm run build
$ cp ./config.sample.json ./config.json
# Edit the config file and add in your azure or aws credentials
$ npm run start
```

## Note on SSL

We *strongly* recommend that you deploy your Gaia hub with SSL enabled. Otherwise, the tokens used to authenticate with the Gaia hub may be stolen by attackers, which could allow them to execute writes on your behalf.

## Configuring the hub

### Driver Selection

The Gaia hub currently supports the following drivers:

```
'aws' == Amazon S3
'azure' == Azure Blob Storage
'disk' == Local disk (you must set up static web-hosting to point at this driver)
'google-cloud' === Google Cloud Storage
```

Set the driver you wish to use in your `config.json` file with the `driver` parameter. Many drivers additionally accept the `bucket` parameter, which controls the bucket name that files should be written to.

These driver may require you to provide additional credentials for performing writes to the backends. See `config.sample.json` for fields for those credentials. In some cases, the driver can use a system configured credential for the backend (e.g., if you are logged into your AWS CLI account, and run the hub from that environment, it won't need to read credentials from your `config.json`).

*Note:* The disk driver requires a *nix like filesystem interface, and will not work correctly when trying to run in a Windows environment.

### Require Correct Hub URL

If you turn on the `requireCorrectHubUrl` option in your `config.json`
file, your Gaia hub will require that authentication requests
correctly include the `hubURL` they are trying to connect with. This
is used to prevent a malicious gaia hub from using an authentication
token for itself on other Gaia hubs.

By default, the Gaia hub will validate that the supplied URL matches
`https://${config.serverName}`, but if there are multiple valid URLs
for clients to reach the hub at, you can include a list in your `config.json`:

```javascript
{
  ....
  serverName: "normalserver.com"
  validHubUrls: [ "https://specialserver.com/",
                  "https://legacyurl.info" ]
  ....
}
```

### The readURL parameter

By default, the gaia hub drivers will return read URLs which point directly at the written content. For example, an S3 driver would return the URL directly to the S3 file. However, if you configure a CDN or domain to point at that same bucket, you can use the `readURL` parameter to tell the gaia hub that files can be read from the given URL. For example, the `hub.blockstack.org` Gaia Hub is configured to return a read URL that looks like `https://gaia.blockstack.org/hub/`.

Unset this configuration parameter if you do not intend to deploy any caching.

### Minimum Proofs Requirement

The gaia hub can also be configured to require a minimum number of social proofs in a user's profile to accept writes from that user. This can be used as a kind of spam-control mechanism. However, we recommend for the smoothest operation of your gaia hub, to set the  `proofsConfig.proofsRequired` configuration key to `0`.

### Install Gaia Hub as Executable

To install the Gaia hub as an executable program (required for integration
testing), do the following:

```bash
$ cd gaia/hub
$ npm run build
$ sudo npm i -g # or, "sudo npm link"
$ which blockstack-gaia-hub
/usr/bin/blockstack-gaia-hub
```

If you intend to run a Gaia hub in production, you will still need to generate a
`config.json` file per the above instructions.

### Deploy the Hub with Docker, nginx

First have `docker`,`nginx` and `certbot` installed on a server with a FQDN pointed to it. The following guides should help you get this setup.

- [Install `nginx`](https://www.digitalocean.com/community/tutorials/how-to-install-nginx-on-ubuntu-16-04)
- [Install `docker`](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-16-04)
- [Install `certbot`](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-16-04) (do not run the setup yet!)

Then do the following:

- Make a folder `$HOME/hub` and copy the configuration file `config.sample.json` to `$HOME/hub/config.json` and add in your desired configuration.
- Copy `nginx.conf.sample` to `$HOME/hub/nginx.conf` and replace `hub.example.com` with your FQDN.
- `sudo rm /etc/nginx/sites-enabled/default && sudo ln $HOME/hub/nginx.conf /etc/nginx/sites-enabled/default`
- Finish `certbot` setup and cert generation
- Pull the docker image and start an instance of the container:

```bash
$ docker pull quay.io/blockstack/gaia-hub:latest
$ docker run -d --restart=always -v $HOME/hub/config.json:/src/hub/config.json -p 3000:3000 -e CONFIG_PATH=/src/hub/config.json quay.io/blockstack/gaia-hub:latest
# Now you can test the hub! The exact output will depend on your configuration
$ curl https://hub.example.com/hub_info | jq
{
  "challenge_text": "[\"gaiahub\",\"2017-09-19\",\"{{ .serverName }}\",\"blockstack_storage_please_sign\"]",
  "read_url_prefix": "https://{{ .bucketName }}.{{ .storageProviderUrl }}/"
}
```

### Run the tests

To run the unit tests:
```bash
$ npm run test
```

To run _driver_ tests and the _integration_ tests, you have
to provide configuration for the drivers. Specify a driver config
file using the environment variables:

```bash
AZ_CONFIG_PATH=test.azure.json
S3_CONFIG_PATH=test.s3.json
```

These files are JSON files that only need to contain your credentials
and bucket. For example, an azure config could look like:

```javascript
{
  "azCredentials": {
    "accountName": "your-azure-account-name",
    "accountKey": "b64-account-key"
  },
  "bucket": "spokes"
}
```

To run the tests with the azure driver tests and integration tests included:

```bash
$ AZ_CONFIG_PATH=test.azure.json npm run test
```

This also provides an easy way to test your storage provider
credentials and setup. If your tests fail the first time that may be
because the bucket setup did not complete before the test exited. Wait
a minute and try the `npm run test` command again.

To configure the logging set the `argsTransport` fields in the config file. Here is a list of [logging configuration options](https://github.com/winstonjs/winston/blob/master/docs/transports.md).


### CDN Stuff

- https://docs.microsoft.com/en-us/azure/storage/blobs/storage-https-custom-domain-cdn


## Running Gaia Hub on AWS Lambda


### Deploying from source

#### Prepare the zip

The first step, after cloning this repo on your machine, is to create the image that will be uploaded on AWS S3 and loaded on AWS Lambda.

Gaia relies on a few dependencies. One of them, named `tiny-secp256k1` is written in `C/C++` requires to be compiled before running.

Lambda is powered by CentOS, and we'll use Vagrant for virtualizing this distribution and prepare our image.

##### Install Vagrant

Follow the instructions available on [vagrantup.com](https://www.vagrantup.com/downloads.html).


##### Prepare the VM


```bash
$ git clone https://github.com/blockstack/gaia.git

$ cd gaia/hub/scripts/vagrant

$ vagrant plugin install vagrant-vbguest

$ vagrant up

```

##### Prepare and upload the image

```bash
$ vagrant ssh

$ cd /gaia-hub

$ npm install

$ aws configure

$ serverless deploy

```

This last command should output the URL of your endpoints.


### Deploying from AWS Lambda Marketplace

Available soon.

