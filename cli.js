#!/usr/bin/env node

'use strict';

const async = require('async');
const colors = require('colors/safe');
const request = require('minimal-request');
const semver = require('semver');
const _ = require('lodash');

var pkg = require('./package');

const getLatestVersion = (module, cb) => {
  request({
    url: `https://skimdb.npmjs.com/registry/_design/app/_view/byField?key=%22${module}%22`,
    json: true
  }, (err, response) => {
    if(err){ return cb(`Unable to connect to NPM: ${err}`); }
    cb(null, response.rows[0].value.version);
  });
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

        if(err){ console.log(err); console.log(componentInfo); return next(err); }

        const isHandlebars = componentInfo.oc.files.template.type === 'handlebars',
              isHandlebars3 = isHandlebars && (!componentInfo.oc.version || semver.lt(componentInfo.oc.version, '0.32.0')),
              isDeprecated = componentInfo.oc.state === 'deprecated';

        if(isHandlebars3 && !isDeprecated){
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
    ocMigrateVersion: next => getLatestVersion('oc-migrate', next),
    ocVersion: next => getLatestVersion('oc', next),
    registryVersion: next => getRegistryVersion(registryUrl, next)
  }, (err, results) => {

    if(err){ return exit(err); }

    if(semver.lt(pkg.version, results.ocMigrateVersion)){
      exit(`oc-migrate is outdated. For upgrading run: [sudo] npm i -g oc-migrate`);
    }

    console.log(`Latest OC version: ${colors.green(results.ocVersion)}`);
    console.log(`${registryUrl} version: ${colors.green(results.registryVersion)}`);
    
    const diff = semver.diff(results.ocVersion, results.registryVersion);
    const safeUpgrade = (diff === 'patch') || (semver.major(results.ocVersion) > 0 && diff === 'minor');

    if(!diff){
      console.log(colors.green('${registryUrl} is already using latest version. Well done.'));
    } else if(safeUpgrade){
      console.log(colors.green(`${registryUrl} can be safely upgraded from ${results.registryVersion} to ${results.ocVersion}.`));
    } else {
      console.log(colors.yellow(`${registryUrl} should be upgraded to the latest version, but be careful: breaking changes are listed here: https://github.com/opentable/oc/blob/master/CHANGELOG.md`));
    }

    if(semver.lt(results.registryVersion, '0.33.0')){

      console.log(colors.yellow(`Analysing components...`));

      getHandlebars3Components(registryUrl, (err, components) => {

        if(err){ return exit(err); }
        
        if(components.length > 0){

          console.log(colors.yellow(`Warning: OC v0.33.X removes support for Handlebars 3, and it looks like some of your components will break if you upgrade to >0.33.X.`))
          console.log(colors.yellow(`${registryUrl} will need to be upgraded to 0.32.X, which supports both Handlebars 3 and 4.`));
          console.log(colors.yellow(`Then, the following components will need to be re-published using Handlebars 4. After that, re-run this tool for upgrading ${registryUrl} to a more recent version.`));
          console.log(colors.yellow(`Note: given OC components immutability, after publishing a new version of each component, you will need to ensure no consumer is consuming previous versions`));

          _.each(components, (component, i) => {
            const author = _.isObject(component.author) ? JSON.stringify(component.author) : component.author;
            const repository = _.isObject(component.repository) ? JSON.stringify(component.repository) : component.repository;
            console.log(colors.red(`${i + 1})\t${component.name}@${component.version} - Maintained by ${author || 'unknown'} ${repository || ''}`));
          });
        } else {
          console.log(colors.green('OK'));
        }

        exit();
      });
    } else {
      exit();
    }
  });
});
