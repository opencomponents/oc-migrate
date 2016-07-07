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

    async.each(response.components, (component, next) => {
      request({
        url: `${component}/~info`,
        json: true
      }, (err, componentInfo) => {

        if(err){ return next(err); }

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

const log = (msg, type) => {
  const colour = { 'error' : 'red', 'warn': 'yellow', 'ok': 'green' }[type];
  
  if(!!colour){
    msg = colors[colour](msg);
  }

  return console.log(msg);
};

const exit = (msg) => {
  if(msg){
    log(msg, 'error');
    process.exit(1);
  }

  process.exit(0);
};

const checkHandlebars3MigrationIssues = (registryUrl, registryVersion, cb) => {

  if(!semver.lt(registryVersion, '0.33.0')){
    return cb();
  };

  log(`Analysing components...`, 'warn');

  getHandlebars3Components(registryUrl, (err, components) => {

    if(err){ return exit(err); }
    
    if(components.length > 0){

      log(`Warning: OC v0.33.X removes support for Handlebars 3, and it looks like some of your components will break if you upgrade to >0.33.X.`, 'warn')
      
      if(semver.gte(registryVersion, '0.32.0')){
        log(`Before upgrading ${registryUrl} to 0.33.X, the following components will need to be re-published using 0.32.X<CLI<0.33.X (which will pick Handlebars 4).`, 'warn');
      } else {
        log(`${registryUrl} will need to be upgraded to 0.32.X, which supports both Handlebars 3 and 4.`, 'warn');
        log(`Only then, the following components will need to be re-published using 0.32.X<CLI<0.33.X (which will pick Handlebars 4).`, 'warn');
      }

      log(`After that, re-run this tool for upgrading ${registryUrl} to a more recent version.`, 'warn');
      log(`Note: given OC components immutability, after publishing a new version of each component, you will need to ensure no consumer is consuming previous versions`, 'warn');

      _.each(components, (component, i) => {
        const author = _.isObject(component.author) ? JSON.stringify(component.author) : component.author;
        const repository = _.isObject(component.repository) ? JSON.stringify(component.repository) : component.repository;
        log(`${i + 1})\t${component.name}@${component.version} - Maintained by ${author || 'unknown'} ${repository || ''}`, 'error');
      });
    } else {
      log('OK', 'ok');
    }

    cb();
  });
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
      exit(`oc-migrate is outdated. For upgrading run: ${colors.green('[sudo] npm i -g oc-migrate')}`);
    }

    log(`Latest OC version: ${colors.green(results.ocVersion)}`);
    log(`${registryUrl} version: ${colors.green(results.registryVersion)}`);
    
    const diff = semver.diff(results.ocVersion, results.registryVersion);
    const safeUpgrade = (diff === 'patch') || (semver.major(results.ocVersion) > 0 && diff === 'minor');

    if(!diff){
      log('${registryUrl} is already using latest version. Well done.', 'ok');
    } else if(safeUpgrade){
      log(`${registryUrl} can be safely upgraded from ${results.registryVersion} to ${results.ocVersion}.`, 'ok');
    } else {
      log(`${registryUrl} should be upgraded to the latest version, but be careful: breaking changes are listed here: https://github.com/opentable/oc/blob/master/CHANGELOG.md`, 'warn');
    }
    
    checkHandlebars3MigrationIssues(registryUrl, results.registryVersion, exit);
  });
});
