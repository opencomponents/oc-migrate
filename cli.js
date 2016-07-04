#!/usr/bin/env node

'use strict';

const async = require('async');
const colors = require('colors/safe');
const request = require('minimal-request');
const semver = require('semver');

const getOcLatestVersion = (cb) => {
  request({
    url: 'https://skimdb.npmjs.com/registry/_design/app/_view/byField?key=%22oc%22',
    json: true
  }, (err, response) => err ? cb(`Unable to connect to NPM: ${err}`) : cb(err, response.rows[0].value.version));
};

const getParams = (cb) => {
  if(process.argv.length < 3){
    return cb('Usage: oc-migrate https://your-registry-url.domain.com');
  }

  cb(null, process.argv[2]);
};

const getRegistryVersion = (registryUrl, cb) => {
  request({
    url: registryUrl,
    json: true
  }, (err, response) => err ? cb(`Unable to connect to registry: ${err}`) : cb(err, response.ocVersion));
};

const getHandlebars3Components = (registryUrl, cb) => {
  request({
    url: registryUrl,
    json: true
  }, (err, response) => {
    let h3components = [];

    if(response.components.length === 0){
      return cb(null, h3components);
    }

    async.eachSeries(response.components, (component, next) => {
      request({
        url: `${component}/~info`,
        json: true
      }, (err, componentInfo) => {

        const isHandlebars = componentInfo.oc.files.template.type === 'handlebars',
              isHandlebars3 = isHandlebars && (!componentInfo.oc.version || semver.lt(componentInfo.oc.version, '0.32.0'));

        if(isHandlebars3){
          h3components.push(componentInfo);
        }
        
        next();
      });
    }, err => cb(err, h3components));
  });
};

const exit = (msg) => {
  if(msg){
    console.log(colors.red(msg));
    process.exit(1);
  }

  process.exit(0);
};

getParams((err, registryUrl) => {
  if(err){ return exit(err); }

  async.parallel({
    ocVersion: next => getOcLatestVersion(next),
    registryVersion: next => getRegistryVersion(registryUrl, next)
  }, (err, results) => {

    if(err){ return exit(err); }

    if(results.ocVersion === results.registryVersion){
      console.log(colors.green('Registry is already using latest version'));
    } else {

      if(semver.lt(results.registryVersion, '0.32.0')){

        getHandlebars3Components(registryUrl, (err, components) => {
          if(components.length === 0){
            console.log(colors.green(`You can safely upgrade from ${results.registryVersion} to ${results.ocVersion}`));
          } else {
            console.log(colors.yellow(`You need to upgrade OC to 0.32.X, which supports both Handlebars 3 and 4 so that you can gracefully upgrade your components.`));
            console.log(colors.yellow(`Then, the following components will need to be re-published using Handlebars 4. After that, you will be able to re-run this tool for upgrading to a more recent version.`));

            _.each(components, (component) => {
              console.log(colors.red(`${component.name}@${component.version} - Maintained by ${component.author || 'unknown'} ${component.repository || ''}`));
            });
          }

          exit();
        });
      } else {
        exit();
      }
    }
  });
});
