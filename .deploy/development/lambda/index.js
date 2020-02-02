var litexa = exports.litexa;
if (typeof(litexa) === 'undefined') { litexa = {}; }
if (typeof(litexa.modulesRoot) === 'undefined') { litexa.modulesRoot = process.cwd(); }
/*
 * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */
var AWS, Entitlements, cloudWatch, db, dynamoDocClient;

AWS = require('aws-sdk');

AWS.config.update({
  region: "us-east-1"
});

//require('coffeescript').register()
dynamoDocClient = new AWS.DynamoDB.DocumentClient({
  convertEmptyValues: true,
  service: new AWS.DynamoDB({
    maxRetries: 5,
    retryDelayOptions: {
      base: 150
    },
    paramValidation: false,
    httpOptions: {
      agent: new (require('https')).Agent({
        keepAlive: true
      })
    }
  })
});

cloudWatch = new AWS.CloudWatch({
  httpOptions: {
    agent: new (require('https')).Agent({
      keepAlive: true
    })
  }
});

db = {
  fetchDB: function({identity, dbKey, fetchCallback}) {
    var DBKEY, databaseObject, mock, params, ref, tableName;
    if (true) {
      tableName = typeof process !== "undefined" && process !== null ? (ref = process.env) != null ? ref.dynamoTableName : void 0 : void 0;
      if (tableName == null) {
        throw new Error("Missing dynamoTableName in the lambda environment. Please set it to the DynamoDB table you'd like to use, in the same AWS account.");
      }
      // we're using per application tables, already partitioned by deployment
      // so all we need here is the device identifier
      DBKEY = dbKey != null ? dbKey : `${identity.deviceId}`;
      params = {
        Key: {
          userId: DBKEY
        },
        TableName: tableName,
        ConsistentRead: true
      };
      //console.log 'fetching from DynamoDB : ' + JSON.stringify(params)
      return dynamoDocClient.get(params, function(err, data) {
        var backing, clock, databaseObject, dirty, lastResponseTime, ref1, ref2, ref3, ref4, wasInitialized;
        if (err) {
          console.error(`Unable to read from dynamo Request was: ${JSON.stringify(params, null, 2)} Error was: ${JSON.stringify(err, null, 2)}`);
          return fetchCallback(err, null);
        } else {
          //console.log "fetched from DB", JSON.stringify(data.Item)
          wasInitialized = ((ref1 = data.Item) != null ? ref1.data : void 0) != null;
          backing = (ref2 = (ref3 = data.Item) != null ? ref3.data : void 0) != null ? ref2 : {};
          if (data.Item != null) {
            clock = (ref4 = data.Item.clock) != null ? ref4 : 0;
            lastResponseTime = data.Item.lastResponseTime;
          } else {
            clock = null;
            lastResponseTime = 0;
          }
          dirty = false;
          databaseObject = {
            isInitialized: function() {
              return wasInitialized;
            },
            initialize: function() {
              return wasInitialized = true;
            },
            read: function(key, markDirty) {
              if (markDirty) {
                dirty = true;
              }
              return backing[key];
            },
            write: function(key, value) {
              backing[key] = value;
              dirty = true;
            },
            finalize: function(finalizeCallback) {
              var dispatchSave, ref5, requiredSpacing, space, wait;
              if (!dirty) {
                return setTimeout((function() {
                  return finalizeCallback();
                }), 1);
              }
              params = {
                TableName: tableName,
                Item: {
                  userId: DBKEY,
                  data: backing
                }
              };
              if (true) {
                if (clock != null) {
                  // item existed, conditionally replace it
                  if (clock > 0) {
                    params.ConditionExpression = "clock = :expectedClock";
                    params.ExpressionAttributeValues = {
                      ":expectedClock": clock
                    };
                  }
                  params.Item.clock = clock + 1;
                } else {
                  // item didn't exist, conditionally create it
                  params.ConditionExpression = "attribute_not_exists(userId)";
                  params.Item.clock = 0;
                }
              }
              dispatchSave = function() {
                //console.log "sending #{JSON.stringify(params)} to dynamo"
                params.Item.lastResponseTime = (new Date()).getTime();
                return dynamoDocClient.put(params, function(err, data) {
                  if ((err != null ? err.code : void 0) === 'ConditionalCheckFailedException') {
                    console.log(`DBCONDITION: ${err}`);
                    databaseObject.repeatHandler = true;
                    err = null;
                  } else if (err != null) {
                    console.error(`DBWRITEFAIL: ${err}`);
                  }
                  return finalizeCallback(err, params);
                });
              };
              space = (new Date()).getTime() - lastResponseTime;
              requiredSpacing = (ref5 = databaseObject.responseMinimumDelay) != null ? ref5 : 500;
              if (space >= requiredSpacing) {
                return dispatchSave();
              } else {
                wait = requiredSpacing - space;
                console.log(`DELAYINGRESPONSE Spacing out ${wait}, ${(new Date()).getTime()} ${lastResponseTime}`);
                return setTimeout(dispatchSave, wait);
              }
            }
          };
          return fetchCallback(null, databaseObject);
        }
      });
    } else {
      mock = {};
      databaseObject = {
        isInitialized: function() {
          return true;
        },
        read: function(key) {
          return mock[key];
        },
        write: function(key, value) {
          return mock[key] = value;
        },
        finalize: function(cb) {
          return setTimeout(cb, 1);
        }
      };
      return setTimeout((function() {
        return fetchCallback(null, databaseObject);
      }), 1);
    }
  }
};

Entitlements = {
  fetchAll: function(event, stateContext, after) {
    var apiEndpoint, apiPath, https, language, options, req, token;
    try {
      https = require('https');
    } catch (error) {
      // no https means no access to internet, can't do this
      console.log("skipping fetchEntitlements, no interface present");
      after();
      return;
    }
    apiEndpoint = "api.amazonalexa.com";
    apiPath = "/v1/users/~current/skills/~current/inSkillProducts";
    token = "bearer " + event.context.System.apiAccessToken;
    language = "en-US";
    options = {
      host: apiEndpoint,
      path: apiPath,
      method: 'GET',
      headers: {
        "Content-Type": 'application/json',
        "Accept-Language": language,
        "Authorization": token
      }
    };
    req = https.get(options, (res) => {
      var returnData;
      res.setEncoding("utf8");
      if (res.statusCode !== 200) {
        after(`failed to fetch entitlements, status code was ${res.statusCode}`);
        return;
      }
      returnData = "";
      res.on('data', (chunk) => {
        return returnData += chunk;
      });
      return res.on('end', () => {
        stateContext.inSkillProducts = JSON.parse(returnData);
        stateContext.db.write("__inSkillProducts", stateContext.inSkillProducts);
        return after();
      });
    });
    return req.on('error', function(e) {
      return after('Error calling InSkillProducts API: ');
    });
  }
};

litexa.overridableFunctions = {
  generateDBKey: function(identity) {
    return `${identity.deviceId}`;
  }
};
  /*
   * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
   * SPDX-License-Identifier: Apache-2.0
   * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   */
var DBTypeWrapper, brightenColor, buildBuyInSkillProductDirective, buildCancelInSkillProductDirective, buildUpsellInSkillProductDirective, daysBetween, deepClone, diceCheck, diceRoll, escapeSpeech, fetchEntitlements, getProductByProductId, getProductByReferenceName, getReferenceNameByProductId, hexFromRGB, hoursBetween, inSkillProductBought, interpolateRGB, isActuallyANumber, minutesBetween, pickSayString, randomArrayItem, randomIndex, reportValueMetric, rgbFromHSL, rgbFromHex, shuffleArray,
  indexOf = [].indexOf;

randomIndex = function(count) {
  return Math.floor(Math.random() * count);
};

shuffleArray = function(array) {
  var a, b, i, j, n, ref, shuffled;
  shuffled = (function() {
    var len, n, results;
    results = [];
    for (n = 0, len = array.length; n < len; n++) {
      a = array[n];
      results.push(a);
    }
    return results;
  })();
  for (i = n = 0, ref = shuffled.length; (0 <= ref ? n < ref : n > ref); i = 0 <= ref ? ++n : --n) {
    j = i + Math.floor(Math.random() * (shuffled.length - i));
    a = shuffled[i];
    b = shuffled[j];
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
};

randomArrayItem = function(array) {
  return array[randomIndex(array.length)];
};

diceRoll = function(sides) {
  // produce a number between 1 and sides, inclusive
  sides = sides != null ? sides : 6;
  return 1 + Math.floor(Math.random() * sides);
};

diceCheck = function(number, sides) {
  return diceRoll(sides) <= number;
};

escapeSpeech = function(line) {
  if (line == null) {
    return "";
  }
  return "" + line;
};

deepClone = function(thing) {
  return JSON.parse(JSON.stringify(thing));
};

isActuallyANumber = function(data) {
  return !isNaN(parseInt(data));
};

pickSayString = function(context, key, count) {
  var cap, history, i, n, ref, ref1, ref2, sayData, value;
  sayData = (ref = context.db.read('__sayHistory')) != null ? ref : [];
  history = (ref1 = sayData[key]) != null ? ref1 : [];
  value = 0;
  switch (false) {
    case count !== 2:
      // with two, we can only toggle anyway
      if (history[0] != null) {
        value = 1 - history[0];
      } else {
        value = randomIndex(2);
      }
      history[0] = value;
      break;
    case !(count < 5):
      // until 4, the pattern below is a little
      // over constrained, producing a repeating
      // set rather than a random sequence,
      // so we only guarantee
      // no adjacent repetition instead
      value = randomIndex(count);
      if (value === history[0]) {
        value = (value + 1) % count;
      }
      history[0] = value;
      break;
    default:
      // otherwise, guarantee we'll see at least
      // half the remaining options before repeating
      // one, up to a capped history of 8, beyond which
      // it's likely too difficult to detect repetition.
      value = randomIndex(count);
      for (i = n = 0, ref2 = count; (0 <= ref2 ? n < ref2 : n > ref2); i = 0 <= ref2 ? ++n : --n) {
        if (indexOf.call(history, value) < 0) {
          break;
        }
        value = (value + 1) % count;
      }
      history.unshift(value);
      cap = Math.min(8, count / 2);
      history = history.slice(0, cap);
  }
  sayData[key] = history;
  context.db.write('__sayHistory', sayData);
  return value;
};

exports.DataTablePrototype = {
  pickRandomIndex: function() {
    return randomIndex(this.length);
  },
  find: function(key, value) {
    var idx, n, ref, row;
    idx = this.keys[key];
    if (idx == null) {
      return null;
    }
    for (row = n = 0, ref = length; (0 <= ref ? n < ref : n > ref); row = 0 <= ref ? ++n : --n) {
      if (this[row][idx] === value) {
        return row;
      }
    }
    return null;
  }
};

exports.Logging = {
  log: function() {
    return console.log.apply(null, arguments);
  },
  error: function() {
    return console.error.apply(null, arguments);
  }
};

minutesBetween = function(before, now) {
  if (!((before != null) && (now != null))) {
    return 999999;
  }
  return Math.floor(Math.abs(now - before) / (60 * 1000));
};

hoursBetween = function(before, now) {
  if (!((before != null) && (now != null))) {
    return 999999;
  }
  return Math.floor(Math.abs(now - before) / (60 * 60 * 1000));
};

daysBetween = function(before, now) {
  if (!((before != null) && (now != null))) {
    return 999999;
  }
  now = (new Date(now)).setHours(0, 0, 0, 0);
  before = (new Date(before)).setHours(0, 0, 0, 0);
  return Math.floor(Math.abs(now - before) / (24 * 60 * 60 * 1000));
};

Math.clamp = function(min, max, x) {
  return Math.min(Math.max(min, x), max);
};

rgbFromHex = function(hex) {
  var read;
  if ((hex != null ? hex.length : void 0) == null) {
    return [0, 0, 0];
  }
  if (hex.indexOf('0x') === 0) {
    hex = hex.slice(2);
  }
  if (hex.indexOf('#') === 0) {
    hex = hex.slice(1);
  }
  switch (hex.length) {
    case 3:
      read = function(v) {
        v = parseInt(v, 16);
        return v + 16 * v;
      };
      return [read(hex[0]), read(hex[1]), read(hex[2])];
    case 6:
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    default:
      return [0, 0, 0];
  }
};

hexFromRGB = function(rgb) {
  var b, g, r;
  r = Math.clamp(0, 255, Math.floor(rgb[0])).toString(16);
  g = Math.clamp(0, 255, Math.floor(rgb[1])).toString(16);
  b = Math.clamp(0, 255, Math.floor(rgb[2])).toString(16);
  if (r.length < 2) {
    r = "0" + r;
  }
  if (g.length < 2) {
    g = "0" + g;
  }
  if (b.length < 2) {
    b = "0" + b;
  }
  return r + g + b;
};

rgbFromHSL = function(hsl) {
  var c, h, l, m, s, x;
  h = (hsl[0] % 360 + 360) % 360;
  s = Math.clamp(0.0, 1.0, hsl[1]);
  l = Math.clamp(0.0, 1.0, hsl[2]);
  h /= 60.0;
  c = (1.0 - Math.abs(2.0 * l - 1.0)) * s;
  x = c * (1.0 - Math.abs(h % 2.0 - 1.0));
  m = l - 0.5 * c;
  c += m;
  x += m;
  m = Math.floor(m * 255);
  c = Math.floor(c * 255);
  x = Math.floor(x * 255);
  switch (Math.floor(h)) {
    case 0:
      return [c, x, m];
    case 1:
      return [x, c, m];
    case 2:
      return [m, c, x];
    case 3:
      return [m, x, c];
    case 4:
      return [x, m, c];
    default:
      return [c, m, x];
  }
};

brightenColor = function(c, percent) {
  var isHex;
  isHex = false;
  if (!Array.isArray(c)) {
    c = rgbFromHex(c);
    isHex = true;
  }
  c = interpolateRGB(c, [255, 255, 255], percent / 100.0);
  if (isHex) {
    return hexFromRGB(c);
  }
  return c;
};

interpolateRGB = function(c1, c2, l) {
  var b, g, r;
  [r, g, b] = c1;
  r += (c2[0] - r) * l;
  g += (c2[1] - g) * l;
  b += (c2[2] - b) * l;
  return [r.toFixed(0), g.toFixed(0), b.toFixed(0)];
};

reportValueMetric = function(metricType, value, unit) {
  var params;
  params = {
    MetricData: [],
    Namespace: 'Litexa'
  };
  params.MetricData.push({
    MetricName: metricType,
    Dimensions: [
      {
        Name: 'project',
        Value: litexa.projectName
      }
    ],
    StorageResolution: 60,
    Timestamp: new Date().toISOString(),
    Unit: unit != null ? unit : 'None',
    Value: value != null ? value : 1
  });
  //console.log "reporting metric #{JSON.stringify(params)}"
  if (typeof cloudWatch === "undefined" || cloudWatch === null) {
    return;
  }
  return cloudWatch.putMetricData(params, function(err, data) {
    if (err != null) {
      return console.error(`Cloudwatch metrics write fail ${err}`);
    }
  });
};

litexa.extensions = {
  postProcessors: [],
  extendedEvents: {},
  load: function(location, name) {
    var fullPath, handler, k, lib, ref, results, testing, v;
    // during testing, this might already be in the shared context, skip it if so
    if (name in litexa.extensions) {
      return;
    }
    //console.log ("skipping extension load, already loaded")
    testing = litexa.localTesting ? "(test mode)" : "";
    //console.log "loading extension #{location}/#{name} #{testing}"
    fullPath = `${litexa.modulesRoot}/${location}/${name}/litexa.extension`;
    lib = litexa.extensions[name] = require(fullPath);
    if (lib.loadPostProcessor != null) {
      handler = lib.loadPostProcessor(litexa.localTesting);
      if (handler != null) {
        //console.log "installing post processor for extension #{name}"
        handler.extensionName = name;
        litexa.extensions.postProcessors.push(handler);
      }
    }
    if (lib.events != null) {
      ref = lib.events(false);
      results = [];
      for (k in ref) {
        v = ref[k];
        //console.log "registering extended event #{k}"
        results.push(litexa.extensions.extendedEvents[k] = v);
      }
      return results;
    }
  },
  finishedLoading: function() {
    var a, b, count, guard, len, len1, len2, len3, n, node, o, p, pp, processors, q, ready, ref, ref1, sorted, t, tag, u;
    // sort the postProcessors by their actions
    processors = litexa.extensions.postProcessors;
    count = processors.length;
// identify dependencies
    for (n = 0, len = processors.length; n < len; n++) {
      a = processors[n];
      a.dependencies = [];
      if (a.consumesTags == null) {
        continue;
      }
      ref = a.consumesTags;
      for (o = 0, len1 = ref.length; o < len1; o++) {
        tag = ref[o];
        for (q = 0, len2 = processors.length; q < len2; q++) {
          b = processors[q];
          if (!(b !== a)) {
            continue;
          }
          if (b.producesTags == null) {
            continue;
          }
          if (indexOf.call(b.producesTags, tag) >= 0) {
            a.dependencies.push(b);
          }
        }
      }
    }
    ready = (function() {
      var len3, results, t;
      results = [];
      for (t = 0, len3 = processors.length; t < len3; t++) {
        a = processors[t];
        if (a.dependencies.length === 0) {
          results.push(a);
        }
      }
      return results;
    })();
    processors = (function() {
      var len3, results, t;
      results = [];
      for (t = 0, len3 = processors.length; t < len3; t++) {
        p = processors[t];
        if (p.dependencies.length > 0) {
          results.push(p);
        }
      }
      return results;
    })();
    sorted = [];
    for (guard = t = 0, ref1 = count; (0 <= ref1 ? t < ref1 : t > ref1); guard = 0 <= ref1 ? ++t : --t) {
      if (ready.length === 0) {
        break;
      }
      node = ready.pop();
      for (u = 0, len3 = processors.length; u < len3; u++) {
        p = processors[u];
        p.dependencies = (function() {
          var len4, ref2, results, w;
          ref2 = p.dependencies;
          results = [];
          for (w = 0, len4 = ref2.length; w < len4; w++) {
            pp = ref2[w];
            if (pp !== node) {
              results.push(pp);
            }
          }
          return results;
        })();
        if (p.dependencies.length === 0) {
          ready.push(p);
        }
      }
      processors = (function() {
        var len4, results, w;
        results = [];
        for (w = 0, len4 = processors.length; w < len4; w++) {
          p = processors[w];
          if (p.dependencies.length > 0) {
            results.push(p);
          }
        }
        return results;
      })();
      sorted.push(node);
    }
    if (sorted.length !== count) {
      throw new Error("Failed to sort postprocessors by dependency");
    }
    return litexa.extensions.postProcessors = sorted;
  }
};

DBTypeWrapper = class DBTypeWrapper {
  constructor(db, language) {
    this.db = db;
    this.language = language;
    this.cache = {};
  }

  read(name) {
    var dbType, value;
    if (name in this.cache) {
      return this.cache[name];
    }
    dbType = __languages[this.language].dbTypes[name];
    value = this.db.read(name);
    if ((dbType != null ? dbType.prototype : void 0) != null) {
      // if this is a typed variable, and it appears
      // the type is a constructible, e.g. a Class
      if (value != null) {
        // patch the prototype if it exists
        Object.setPrototypeOf(value, dbType.prototype);
      } else {
        // or construct a new instance
        value = new dbType;
        this.db.write(name, value);
      }
    } else if ((dbType != null ? dbType.Prepare : void 0) != null) {
      // otherwise if it's typed and it provides a
      // wrapping Prepare function
      if (value == null) {
        if (dbType.Initialize != null) {
          // optionally invoke an initialize
          value = dbType.Initialize();
        } else {
          // otherwise assume we start from an
          // empty object
          value = {};
        }
        this.db.write(name, value);
      }
      // wrap the cached object, whatever it is
      // the function wants to return. Note it's
      // still the input value object that gets saved
      // to the database either way!
      value = dbType.Prepare(value);
    }
    this.cache[name] = value;
    return value;
  }

  write(name, value) {
    var dbType;
    // clear out the cache on any writes
    delete this.cache[name];
    dbType = __languages[this.language].dbTypes[name];
    if (dbType != null) {
      // for typed objects, we can only replace with
      // another object, OR clear out the object and
      // let initialization happen again on the next
      // read, whenever that happens
      if (value == null) {
        return this.db.write(name, null);
      } else if (typeof value === 'object') {
        return this.db.write(name, value);
      } else {
        throw new Error(`@${name} is a typed variable, you can only assign an object or null to it.`);
      }
    } else {
      return this.db.write(name, value);
    }
  }

  finalize(cb) {
    return this.db.finalize(cb);
  }

};

// Monetization
inSkillProductBought = async function(stateContext, referenceName) {
  var isp;
  isp = (await getProductByReferenceName(stateContext, referenceName));
  return (isp != null ? isp.entitled : void 0) === 'ENTITLED';
};

getProductByReferenceName = async function(stateContext, referenceName) {
  var len, n, p, ref;
  if (stateContext.monetization.fetchEntitlements) {
    await fetchEntitlements(stateContext);
  }
  ref = stateContext.monetization.inSkillProducts;
  for (n = 0, len = ref.length; n < len; n++) {
    p = ref[n];
    if (p.referenceName === referenceName) {
      return p;
    }
  }
  return null;
};

getProductByProductId = async function(stateContext, productId) {
  var len, n, p, ref;
  if (stateContext.monetization.fetchEntitlements) {
    await fetchEntitlements(stateContext);
  }
  ref = stateContext.monetization.inSkillProducts;
  for (n = 0, len = ref.length; n < len; n++) {
    p = ref[n];
    if (p.productId === productId) {
      return p;
    }
  }
  return null;
};

buildBuyInSkillProductDirective = async function(stateContext, referenceName) {
  var isp;
  isp = (await getProductByReferenceName(stateContext, referenceName));
  if (isp == null) {
    console.log(`buildBuyInSkillProductDirective(): in-skill product "${referenceName}" not found.`);
    return;
  }
  stateContext.directives.push({
    "type": "Connections.SendRequest",
    "name": "Buy",
    "payload": {
      "InSkillProduct": {
        "productId": isp.productId
      }
    },
    "token": "bearer " + stateContext.event.context.System.apiAccessToken
  });
  return stateContext.shouldEndSession = true;
};

fetchEntitlements = function(stateContext, ignoreCache = false) {
  if (!stateContext.monetization.fetchEntitlements && !ignoreCache) {
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    var apiEndpoint, apiPath, https, options, req, token;
    try {
      https = require('https');
    } catch (error) {
      console.log("skipping fetchEntitlements, no https present");
      reject();
    }
    if (!stateContext.event.context.System.apiEndpoint) {
      // If there's no API endpoint this is an offline test.
      resolve();
    }
    // endpoint is region-specific:
    // e.g. https://api.amazonalexa.com vs. https://api.eu.amazonalexa.com
    apiEndpoint = stateContext.event.context.System.apiEndpoint;
    apiEndpoint = apiEndpoint.replace("https://", "");
    apiPath = "/v1/users/~current/skills/~current/inSkillProducts";
    token = "bearer " + stateContext.event.context.System.apiAccessToken;
    options = {
      host: apiEndpoint,
      path: apiPath,
      method: 'GET',
      headers: {
        "Content-Type": 'application/json',
        "Accept-Language": stateContext.request.locale,
        "Authorization": token
      }
    };
    req = https.get(options, (res) => {
      var returnData;
      res.setEncoding("utf8");
      if (res.statusCode !== 200) {
        reject();
      }
      returnData = "";
      res.on('data', (chunk) => {
        return returnData += chunk;
      });
      return res.on('end', () => {
        var ref;
        console.log(`fetchEntitlements() returned: ${returnData}`);
        stateContext.monetization.inSkillProducts = (ref = JSON.parse(returnData).inSkillProducts) != null ? ref : [];
        stateContext.monetization.fetchEntitlements = false;
        stateContext.db.write("__monetization", stateContext.monetization);
        return resolve();
      });
    });
    return req.on('error', function(e) {
      console.log(`Error while querying inSkillProducts: ${e}`);
      return reject(e);
    });
  });
};

getReferenceNameByProductId = function(stateContext, productId) {
  var len, n, p, ref;
  ref = stateContext.monetization.inSkillProducts;
  for (n = 0, len = ref.length; n < len; n++) {
    p = ref[n];
    if (p.productId === productId) {
      return p.referenceName;
    }
  }
  return null;
};

buildCancelInSkillProductDirective = async(stateContext, referenceName) => {
  var isp;
  isp = (await getProductByReferenceName(stateContext, referenceName));
  if (isp == null) {
    console.log(`buildCancelInSkillProductDirective(): in-skill product "${referenceName}" not found.`);
    return;
  }
  stateContext.directives.push({
    "type": "Connections.SendRequest",
    "name": "Cancel",
    "payload": {
      "InSkillProduct": {
        "productId": isp.productId
      }
    },
    "token": "bearer " + stateContext.event.context.System.apiAccessToken
  });
  return stateContext.shouldEndSession = true;
};

buildUpsellInSkillProductDirective = async(stateContext, referenceName, upsellMessage = '') => {
  var isp;
  isp = (await getProductByReferenceName(stateContext, referenceName));
  if (isp == null) {
    console.log(`buildUpsellInSkillProductDirective(): in-skill product "${referenceName}" not found.`);
    return;
  }
  stateContext.directives.push({
    "type": "Connections.SendRequest",
    "name": "Upsell",
    "payload": {
      "InSkillProduct": {
        "productId": isp.productId
      },
      "upsellMessage": upsellMessage
    },
    "token": "bearer " + stateContext.event.context.System.apiAccessToken
  });
  return stateContext.shouldEndSession = true;
};

/*
 * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */
litexa.gadgetAnimation = {
  // Gadget animations are for Echo Buttons right now
  // this is about animating the colors on the buttons
  // with the SetLight directive
  buildKey: function(color, duration, blend) {
    if (color[0] === '#') {
      // build the inner key structure of an
      // animation to pass into directive
      color = color.slice(1);
    }
    return {
      color: color.toUpperCase(),
      durationMs: duration,
      blend: blend != null ? blend : true
    };
  },
  animationFromArray: function(keyData) {
    var build, d, i, len, results;
    // build an animation array suitable to give
    // the directive function, from an array of
    // arrays of arguments to pass buildKey
    // e.g. [ ['FF0000',1000,true], ['00FFFF',2000,true] ]
    build = litexa.gadgetAnimation.buildKey;
    results = [];
    for (i = 0, len = keyData.length; i < len; i++) {
      d = keyData[i];
      results.push(build(d[0], d[1], d[2]));
    }
    return results;
  },
  singleColorDirective: function(targets, color, duration) {
    var animation;
    animation = [litexa.gadgetAnimation.buildKey(color, duration, false)];
    return litexa.gadgetAnimation.directive(targets, 1, animation, "none");
  },
  resetTriggersDirectives: function(targets) {
    return [litexa.gadgetAnimation.directive(targets, 1, [litexa.gadgetAnimation.buildKey("FFFFFF", 100, false)], "buttonDown"), litexa.gadgetAnimation.directive(targets, 1, [litexa.gadgetAnimation.buildKey("FFFFFF", 100, false)], "buttonUp")];
  },
  directive: function(targets, repeats, animation, trigger, delay) {
    return {
      // directive to animate Echo buttons
      type: "GadgetController.SetLight",
      version: 1,
      targetGadgets: targets,
      parameters: {
        triggerEvent: trigger != null ? trigger : "none",
        triggerEventTimeMs: delay != null ? delay : 0,
        animations: [
          {
            targetLights: ["1"],
            repeat: repeats,
            sequence: animation
          }
        ]
      }
    };
  }
};

// *** Initializer functions from loaded extensions
let extensionEvents = {};
let extensionRequests = {};
function initializeExtensionObjects(context){
  let ref = null;

};
litexa.extendedEventNames = [];
// END OF LIBRARY CODE

// version summary
const userAgent = "@litexa/core/0.3.1 Node/v12.10.0";

litexa.projectName = 'lost-in-translation';
var __languages = {};
__languages['default'] = { enterState:{}, processIntents:{}, exitState:{}, dataTables:{} };
litexa.sayMapping = [

];
litexa.dbTypes = {
  master: { type: 'Master' }
};
var jsonSourceFiles = {}; 
jsonSourceFiles['database.json'] = {
  "ill_be_back": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie, Terminator",
      "Arnold Schwarzenegger"
    ],
    "answer": "I'll be back",
    "answer_annotation": "Spoken by the character Terminator, played by Arnold Schwarzenegger, from the movie, Terminator",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "luke_i_am_your_father": {
    "accent": "Norwegian",
    "hints": [
      "Star Wars",
      "Darth Vader",
      "Luke Skywalker"
    ],
    "answer": "Luke I am your father",
    "answer_annotation": "Spoken by the character Darth Vader, voiced by James Earl Jones, from the Star Wars movie series",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "im_going_to_make_him_an_offer_he_cant_refuse": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie, Godfather",
      "Marlon Brando"
    ],
    "answer": "I'm going to make him an offer he can't refuse",
    "answer_annotation": "Spoken by the character Don Vito Corleone, played by Marlon Brando, from the movie, The Godfather",
    "type": "Movie Quotes",
    "difficulty": "9"
  },
  "may_the_force_be_with_you": {
    "accent": "Icelandic",
    "hints": [
      "Quote from the Star Wars movie series",
      "Fourth of May"
    ],
    "answer": "May the force be with you",
    "answer_annotation": "Spoken by various characters in the series Star Wars",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "you_talking_to_me": {
    "accent": "Romanian",
    "hints": [
      "Robert DeNiro",
      "Quote from the movie, Taxi Driver",
      "Who am I talking to?"
    ],
    "answer": "You talking to me",
    "answer_annotation": "Spoken by Travis Bickle, played by Robert DeNiro, from the movie, Taxi Driver",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "frankly_my_dear_i_dont_give_a_damn": {
    "accent": "Australian",
    "hints": [
      "Quote from the movie, Gone with the Wind",
      "Clark Gable"
    ],
    "answer": "Frankly my dear I don't give a damn",
    "answer_annotation": "Spoken by the character Rhett Butler, played by Clark Gable, from the movie, Gone with the Wind",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "go_ahead_make_my_day": {
    "accent": "French",
    "hints": [
      "Clint Eastwood",
      "Quote from the movie, Sudden Impact"
    ],
    "answer": "Go ahead make my day",
    "answer_annotation": "Spoken by the character Harry Callahan, played by Clint Eastwood, from the movie, Sudden Impact",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "bond_james_bond": {
    "accent": "Turkish",
    "hints": [
      "zero zero seven",
      "famous spy movie series"
    ],
    "answer": "Bond James Bond",
    "answer_annotation": "Spoken by the character James Bond from the James Bond movie series",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "show_me_the_money": {
    "accent": "Chinese",
    "hints": [
      "Quote from the movie, Jerry Maguire",
      "Tom Cruise",
      "Cuba Gooding Jr",
      "Something a bank robber might say"
    ],
    "answer": "Show me the money",
    "answer_annotation": "Spoken by the character Rodney Tidwell, played by Cuba Gooding Jr., from the movie, Jerry Maguire",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "you_cant_handle_the_truth": {
    "accent": "Portugese",
    "hints": [
      "Quote from the movie, A Few Good Men",
      "Jack Nicholson"
    ],
    "answer": "You can't handle the truth",
    "answer_annotation": "Spoken by the character Colonel Nathan R. Jessup, played by Jack Nicholson, from the movie, A Few Good Men",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "houston_we_have_a_problem": {
    "accent": "German",
    "hints": [
      "Apollo 13",
      "NASA"
    ],
    "answer": "Houston we have a problem",
    "answer_annotation": "Spoken by the character Jim Lovell, played by Tom Hanks, from the movie, Apollo 13",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "elementary_my_dear_watson": {
    "accent": "Japanese",
    "hints": [
      "first through fifth or sixth grade",
      "Quote from Sherlock Holmes"
    ],
    "answer": "Elementary my dear Watson",
    "answer_annotation": "Spoken by the character Sherlock Holmes from the Sherlock Holmes movie series",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "hasta_la_vista_baby": {
    "accent": "Japanese",
    "hints": [
      "Goodbye in Spanish",
      "Arnold Schwarzenegger",
      "Quote from the movie, Terminator"
    ],
    "answer": "Hasta la vista baby",
    "answer_annotation": "Spoken by the character Terminator, played by Arnold Schwarzenegger, from the movie, Terminator",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "my_precious": {
    "accent": "Korean",
    "hints": [
      "A ring to rule them all",
      "Smeagol",
      "Quote from Lord of the Rings"
    ],
    "answer": "My precious",
    "answer_annotation": "Spoken by the character Smeagol/Golumn from the Lord of the Rings",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "i_am_groot": {
    "accent": "Castilian Spanish",
    "hints": [
      "Language of a sentient plant",
      "Green Tree Dude",
      "Quote from Guardians of the galaxy"
    ],
    "answer": "I am Groot",
    "answer_annotation": "Spoken by the character Groot from the Guardians of the Galaxy movie series",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "i_want_to_play_a_game": {
    "accent": "Portugese Brazilian",
    "hints": [
      "Do you like games?",
      "Serial killer character",
      "Quote from the movie, Saw"
    ],
    "answer": "I want to play a game",
    "answer_annotation": "Spoken by the character Jigsaw from the Saw movie series",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "this_is_sparta": {
    "accent": "German",
    "hints": [
      "An famous ancient Greek city",
      "Quote from the movie, 300"
    ],
    "answer": "This is Sparta",
    "answer_annotation": "Spoken by the character Leonidas, played by Gerald Butler, from the movie, 300",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "youre_a_wizard_harry": {
    "accent": "french",
    "hints": [
      "Witchcraft and Wizardry",
      "Quote from Harry Potter"
    ],
    "answer": "You're a wizard Harry",
    "answer_annotation": "Spoken by the character Rubeus Hagrid, played by Robbie Coltrane, from the Harry Potter movie series",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "just_keep_swimming": {
    "accent": "German",
    "hints": [
      "Don't give up",
      "Pixar",
      "Quote from the movie, Finding Nemo"
    ],
    "answer": "Just keep swimming",
    "answer_annotation": "Spoken by the character Dory, voiced by Ellen DeGeneres, from the movie, Finding Nemo",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "i_volunteer_as_tribute": {
    "accent": "Dutch",
    "hints": [
      "Quote from the Hunger Games series",
      "Katniss Everdeen",
      "Jennifer Lawrence",
      "District 12"
    ],
    "answer": "I volunteer as tribute",
    "answer_annotation": "Spoken by the character Katniss Everdeen, played by Jennifer Lawrence, from the movie, Hunger Games",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "with_great_power_comes_great_responsibility": {
    "accent": "Dutch",
    "hints": [
      "Quote from Spider-man series",
      "Uncle Ben"
    ],
    "answer": "With great power comes great responsibility",
    "answer_annotation": "Spoken by the character Uncle Ben from the Spider-man series",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "you_will_ride_eternal_shiny_and_chrome": {
    "accent": "Dutch",
    "hints": [
      "Quote from the movie Mad Max: Fury Road"
    ],
    "answer": "You will ride eternal shiny and chrome",
    "answer_annotation": "Spoken by Keays-Byrne as Immortan Joe from the movie Mad Max: Fury Road",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "honey_where_is_my_super_suit": {
    "accent": "Arabic",
    "hints": [
      "Quote from the movie, The Incredibles",
      "Spoken by Frozone"
    ],
    "answer": "Honey Where is my super suit",
    "answer_annotation": "Spoken by the character Frozone, voiced by Samuel L. Jackson, from the movie, The Incredibles",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "why_so_serious": {
    "accent": "Italian",
    "hints": [
      "Quote from the movie, The Dark Knight",
      "Spoken by the Joker"
    ],
    "answer": "Why so serious",
    "answer_annotation": "Spoken by the character Joker, played by Heath Ledger, from the movie, The Dark Knight",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "you_shall_not_pass": {
    "accent": "Icelandic",
    "hints": [
      "Quote from The Lord of the Rings series",
      "Spoken by Gandalf"
    ],
    "answer": "You shall not pass",
    "answer_annotation": "Spoken by the character Gandalf, played by Ian McKellen, from the Lord of the Rings series",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "are_you_not_entertained": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie, Gladiator",
      "Spoken by Maximus Decimus Meridius, Commander of the Armies of the North, General of the Felix Legions, loyal servant to the true emperor, Marcus Aurelius. Father to a murdered son, husband to a murdered wife. And he will have his vengeance, in this life or the next."
    ],
    "answer": "Are you not entertained",
    "answer_annotation": "Spoken by the character Maximus Decimus Meridius, played by Russell Crowe, from the movie, Gladiator",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "you_sit_on_a_throne_of_lies": {
    "accent": "French",
    "hints": [
      "Quote from the movie, Elf",
      "Spoken by Buddy, an elf"
    ],
    "answer": "You sit on a throne of lies",
    "answer_annotation": "Spoken by the character Buddy the elf, played by Will Ferrell, from the movie, Elf",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "i_live_my_life_a_quarter_mile_at_a_time": {
    "accent": "Portuguese",
    "hints": [
      "Quote from the movie, The Fast and the Furious",
      "Spoken by the character Dominic Toretto, played by Vin Diesel",
      "25 cents"
    ],
    "answer": "I live my life a quarter mile at a time",
    "answer_annotation": "Spoken by the character Dominic Toretto, played by Vin Diesel, from the movie, The Fast and the Furious",
    "type": "Movie Quotes",
    "difficulty": "9"
  },
  "i_can_do_this_all_day": {
    "accent": "British",
    "hints": [
      "Quote from the Avengers movie series.",
      "Spoken by Captain America."
    ],
    "answer": "I can do this all day",
    "answer_annotation": "Spoken by the character Captain America, played by Chris Evans, from the Avengers movie series",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "e_t_phone_home": {
    "accent": "Chinese",
    "hints": [
      "Quote from the movie, E.T. the Extra-Terrestrial",
      "Spoken by E.T."
    ],
    "answer": "ET Phone home",
    "answer_annotation": "Spoken by E.T. from the movie, E.T. the Extra-Terrestrial",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "rosebud": {
    "accent": "Italian",
    "hints": [
      "Quote from the movie, Citizen Kane",
      "An undeveloped or embryonic shoot that normally occurs in the axil of a leaf or at the tip of a stem."
    ],
    "answer": "Rosebud",
    "answer_annotation": "Spoken by the character Charles Foster Kane, played by Orson Welles, from the movie, Citizen Kane",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "theres_no_place_like_home": {
    "accent": "Russian",
    "hints": [
      "Quote from the movie, The Wizard of Oz",
      "Close your eyes, tap your ruby heels together three times, and say..."
    ],
    "answer": "There's no place like home",
    "answer_annotation": "Spoken by the character Dorothy Gale, played by Judy Garland, from the movie, The Wizard of Oz",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "say_hello_to_my_little_friend": {
    "accent": "Arabic",
    "hints": [
      "Quote from the movie, Scarface",
      "When your friend is a M16 machine gun."
    ],
    "answer": "Say hello to my little friend",
    "answer_annotation": "Spoken by the character Tony Montana, played by Al Pacino, from the movie, Scarface",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "a_martini_shaken_not_stirred": {
    "accent": "Japanese",
    "hints": [
      "007",
      "A spy's favorite drink"
    ],
    "answer": "A martini Shaken not stirred",
    "answer_annotation": "Spoken by the character James Bond from the James Bond movie series",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "mama_always_said_life_was_like_a_box_of_chocolates_you_never_know_what_youre_gonna_get": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie, Forrest Gump",
      "Spoken by Tom Hanks as Forrest Gump"
    ],
    "answer": "Mama always said life was like a box of chocolates You never know what you're gonna get",
    "answer_annotation": "Spoken by Tom Hanks as Forrest Gump from the movie Forrest Gump",
    "type": "Movie Quotes",
    "difficulty": "10"
  },
  "love_means_never_having_to_say_youre_sorry": {
    "accent": "German",
    "hints": [
      "Quote from the movie, Love Story"
    ],
    "answer": "Love means never having to say you're sorry",
    "answer_annotation": "Spoken by the various characters from the movie, Love Story",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "they_may_take_our_lives_but_theyll_never_take_our_freedom": {
    "accent": "German",
    "hints": [
      "Quote from the movie, Braveheart",
      "Spoken by the character William Wallace, played by Mel Gibson"
    ],
    "answer": "They may take our lives but they'll never take our freedom!",
    "answer_annotation": "Spoken by the character William Wallace, played by Mel Gibson, from the movie, Braveheart",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "oh_my_god_i_am_totally_buggin": {
    "accent": "Chinese",
    "hints": [
      "Quote from the movie, Clueless",
      "Spoken by the character Cher, played by Alicia Silverstone"
    ],
    "answer": "Oh my god I am totally bugging!",
    "answer_annotation": "Spoken by the character Cher, played by Alicia Silverstone, from the movie, Clueless",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "magic_mirror_on_the_wall_who_is_the_fairest_one_of_all": {
    "accent": "Portuguese",
    "hints": [
      "Quote from the movie, Snow White and the Seven Dwarves",
      "Spoken by the character Evil Queen, voiced by Lucille La Verne"
    ],
    "answer": "Magic Mirror on the wall who is the fairest one of all?",
    "answer_annotation": "Spoken by the character Evil Queen, voiced by Lucille La Verne, from the movie, Snow White and the Seven Dwarves",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "wax_on_wax_off": {
    "accent": "Polish",
    "hints": [
      "Quote from the movie, The Karate Kid",
      "Spoken by the character Mr. Miyagi, played by Noriyuki Morita"
    ],
    "answer": "Wax on wax off",
    "answer_annotation": "Spoken by the character Mr. Miyagi, played by Noriyuki Morita, from the movie, The Karate Kid",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "alright_alright_alright": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie, Dazed and Confused",
      "Spoken by the character David Wooderson, played by Matthew McConaughey"
    ],
    "answer": "Alright alright alright",
    "answer_annotation": "Spoken by the character David Wooderson, played by Matthew McConaughey, from the movie, Dazed and Confused",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "the_dude_abides": {
    "accent": "Icelandic",
    "hints": [
      "Quote from the movie, The Big Lebowski",
      "Spoken by the character The Dude, played by Jeff Bridges"
    ],
    "answer": "The Dude abides",
    "answer_annotation": "Spoken by the character The Dude, played by Jeff Bridges, from the movie, The Big Lebowski",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "that_is_so_fetch": {
    "accent": "Icelandic",
    "hints": [
      "Quote from the movie, Mean Girls",
      "Spoken by the character Gretchen Wieners, played by Lacey Chabert"
    ],
    "answer": "That is so fetch!",
    "answer_annotation": "Spoken by the character Gretchen Wieners, played by Lacey Chabert, from the movie, Mean Girls",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "stop_trying_to_make_fetch_happen_its_not_going_to_happen": {
    "accent": "Turkish",
    "hints": [
      "Quote from the movie, Mean Girls",
      "Spoken by the character Regina George, played by Rachel McAdams"
    ],
    "answer": "Stop trying to make fetch happen It's not going to happen",
    "answer_annotation": "Spoken by the character Regina George, played by Rachel McAdams, from the movie, Mean Girls",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "on_wednesdays_we_wear_pink": {
    "accent": "Italian",
    "hints": [
      "Quote from the movie, Mean Girls",
      "Spoken by the character Karen Smith, played by Amanda Seyfried"
    ],
    "answer": "On Wednesdays we wear pink",
    "answer_annotation": "Spoken by the character Karen Smith, played by Amanda Seyfried, from the movie, Mean Girls",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "get_in_loser_were_going_shopping": {
    "accent": "Russian",
    "hints": [
      "Quote from the movie, Mean Girls",
      "Spoken by the character Regina George, played by Rachel McAdams"
    ],
    "answer": "Get in loser we're going shopping",
    "answer_annotation": "Spoken by the character Regina George, played by Rachel McAdams, from the movie, Mean Girls",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "why_dont_you_make_like_a_tree_and_get_outta_here": {
    "accent": "Russian",
    "hints": [
      "Quote from the movie, Back to the Future",
      "Spoken by the character Biff Tannen, played by Thomas F. Wilson"
    ],
    "answer": "Why don't you make like a tree and get outta here",
    "answer_annotation": "Spoken by the character Biff Tannen, played by Thomas F. Wilson, from the movie, Back to the Future",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "roads_where_were_going_we_dont_need_roads": {
    "accent": "Castilian Spanish",
    "hints": [
      "Quote from the movie, Back to the Future",
      "Spoken by the character Dr. Emmett Brown, played by Christopher Lloyd"
    ],
    "answer": "Roads Where we're going we don't need roads",
    "answer_annotation": "Spoken by the character Dr. Emmett Brown, played by Christopher Lloyd, from the movie, Back to the Future",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "fasten_your_seatbelts_its_going_to_be_a_bumpy_night": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie, All about Eve",
      "Spoken by the character Margo Channing, played by Bette Davis",
      "the last word, 'night', is often misquoted as 'ride'"
    ],
    "answer": "Fasten your seatbelts It's going to be a bumpy night",
    "answer_annotation": "Spoken by the character Margo Channing, played by Bette Davis, from the movie, All about Eve",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "to_infinity_and_beyond": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie, Toy Story",
      "Spoken by the character Buzz Lightyear, voiced by Tim Allen"
    ],
    "answer": "To infinity and beyond!",
    "answer_annotation": "Spoken by the character Buzz Lightyear, voiced by Tim Allen, from the movie, Toy Story",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "no_capes": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie, The Incredibles",
      "Spoken by the character Edna Mode, voiced by Brad Bird"
    ],
    "answer": "No capes!",
    "answer_annotation": "Spoken by the character Edna Mode, voiced by Brad Bird, from the movie, The Incredibles",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "not_everyone_can_become_a_great_artist_but_a_great_artist_can_come_from_anywhere": {
    "accent": "Chinese",
    "hints": [
      "Quote from the movie, Ratatouille",
      "Spoken by the character Auguste Gusteau, voiced by Brad Garrett"
    ],
    "answer": "Not everyone can become a great artist but a great artist can come from anywhere",
    "answer_annotation": "Spoken by the character Auguste Gusteau, voiced by Brad Garrett, from the movie, Ratatouille",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "fish_are_friends_not_food": {
    "accent": "Swedish",
    "hints": [
      "Quote from the movie, Finding Nemo",
      "Spoken by the character Bruce, voiced by Barry Humphries"
    ],
    "answer": "Fish are friends not food",
    "answer_annotation": "Spoken by the character Bruce, voiced by Barry Humphries, from the movie, Finding Nemo",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "youre_gonna_need_a_bigger_boat": {
    "accent": "Turkish",
    "hints": [
      "Quote from the movie, Jaws",
      "Spoken by the character Chief Martin Brody, voiced by Roy Scheider"
    ],
    "answer": "You're gonna need a bigger boat",
    "answer_annotation": "Spoken by the character Chief Martin Brody, voiced by Roy Scheider, from the movie, Jaws",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "youre_embarrassing_me_in_front_of_the_wizards": {
    "accent": "Polish",
    "hints": [
      "Quote from the movie, Avengers: Infinity War",
      "Spoken by Robert Downey Jr. as Tony Stark"
    ],
    "answer": "You're embarrassing me in front of the wizards",
    "answer_annotation": "Spoken by the Robert Downey Jr. as Tony Stark in the movie Avengers: Infinity War",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "im_batman": {
    "accent": "Icelandic",
    "hints": [
      "Quote from the Batman movie series",
      "Spoken by the character Batman"
    ],
    "answer": "I'm batman",
    "answer_annotation": "Spoken by the character Batman from the Batman movie series",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "its_not_who_i_am_underneath_but_what_i_do_that_defines_me": {
    "accent": "Italian",
    "hints": [
      "Quote from the movie, Batman Begins",
      "Spoken by the character Batman, played by Christian Bale"
    ],
    "answer": "It’s not who I am underneath but what I do that defines me",
    "answer_annotation": "Spoken by the character Batman, played by Christian Bale, from the movie, Batman Begins",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "some_men_just_want_to_watch_the_world_burn": {
    "accent": "Australian",
    "hints": [
      "Quote from the movie, The Dark Knight",
      "Spoken by the character Alfred Pennyworth, played by Michael Caine"
    ],
    "answer": "Some men just want to watch the world burn",
    "answer_annotation": "Spoken by the character Alfred Pennyworth, played by Michael Caine, from the movie, The Dark Knight",
    "type": "Movie Quotes",
    "difficulty": "1"
  },
  "you_musnt_be_afraid_to_dream_a_little_bigger_darling": {
    "accent": "Swedish",
    "hints": [
      "Quote from the movie, Inception",
      "Dream big"
    ],
    "answer": "You mustn't be afraid to dream a little bigger darling",
    "answer_annotation": "Spoken by the various character from the movie, Inception",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "i_wish_i_knew_how_to_quit_you": {
    "accent": "Norwegian",
    "hints": [
      "Quote from the movie, Brokeback Mountain",
      "Spoken by Jake Gyllenhaal as Jack Twist"
    ],
    "answer": "I wish I knew how to quit you",
    "answer_annotation": "Spoken by Jake Gyllenhaal as Jack Twist in the movie Brokeback Mountain",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "i_am_iron_man": {
    "accent": "Danish",
    "hints": [
      "Quote from the movie Iron Man",
      "Spoken by Robert Downey Jr. as Tony Stark"
    ],
    "answer": "I am Iron Man",
    "answer_annotation": "Spoken by Robert Downey Jr. as Tony Stark in the movie Iron Man",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "im_a_dude_playin_a_dude_disguised_as_another_dude": {
    "accent": "Danish",
    "hints": [
      "Quote from the movie Tropic Thunder",
      "Spoken by Robert Downey Jr. as Kirk Lazarus"
    ],
    "answer": "I'm a dude playing a dude disguised as another dude!",
    "answer_annotation": "Spoken by Robert Downey Jr. as Kirk Lazarus in the movie Tropic Thunder",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "get_busy_livin_or_get_busy_dyin": {
    "accent": "Romanian",
    "hints": [
      "Quote from the movie Shawshank Redemption"
    ],
    "answer": "Get busy living or get busy dying",
    "answer_annotation": "Spoken by various characters from the movie The Shawshank Redemption",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "how_do_you_like_them_apples": {
    "accent": "Norwegian",
    "hints": [
      "Quote from the movie Good Will Hunting",
      "Spoken by Matt Damon as Will Hunting"
    ],
    "answer": "How do you like them apples?",
    "answer_annotation": "Spoken by Matt Damon as Will Hunting from the movie Good Will Hunting",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "we_all_float_down_here": {
    "accent": "Danish",
    "hints": [
      "Quote from the movie It",
      "Spoken by Bill Skarsgård as Pennywise The Dancing Clown"
    ],
    "answer": "We all float down here",
    "answer_annotation": "Spoken by Bill Skarsgård as Pennywise The Dancing Clown from the movie It",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "terrified_mortified_petrified_stupified_by_you": {
    "accent": "Swedish",
    "hints": [
      "Quote from the movie A Beautiful Mind",
      "Spoken by Russell Crowe as John Nash"
    ],
    "answer": "Terrified mortified petrified stupified by you",
    "answer_annotation": "Spoken by Russell Crowe as John Nash from the movie A Beautiful Mind",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "do_or_do_not_there_is_no_try": {
    "accent": "Welsh",
    "hints": [
      "Quote from the movie Star Wars: the Empire Strikes Back",
      "Spoken by Frank Oz as Yoda"
    ],
    "answer": "Do or do not There is no try",
    "answer_annotation": "Spoken by Frank Oz as Yoda from the movie Star Wars: the Empire Strikes Back",
    "type": "Movie Quotes",
    "difficulty": "2"
  },
  "im_king_of_the_world": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie Titanic",
      "Spoken by Leonardo DiCaprio as Jack Dawson"
    ],
    "answer": "I'm king of the world",
    "answer_annotation": "Spoken by Leonardo DiCaprio as Jack Dawson from the movie Titanic",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "ill_get_you_my_pretty_and_your_little_dog_too": {
    "accent": "Norwegian",
    "hints": [
      "Quote from the movie The Wizard of Oz",
      "Spoken by Margaret Hamilton as The Wicked Witch of the West"
    ],
    "answer": "I'll get you my pretty and your little dog too!",
    "answer_annotation": "Spoken by Margaret Hamilton as The Wicked Witch of the West from the movie The Wizard of Oz",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "i_feel_the_need_the_need_for_speed": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie Top Gun",
      "Spoken by Tom Cruise as Pete 'Maverick' Mitchell"
    ],
    "answer": "I feel the need the need for speed!",
    "answer_annotation": "Spoken by Tom Cruise as Pete 'Maverick' Mitchell from the movie Top Gun",
    "type": "Movie Quotes",
    "difficulty": "8"
  },
  "heres_johnny": {
    "accent": "Dutch",
    "hints": [
      "Quote from the movie The Shining",
      "Spoken by Jack Nicholson as Jack Torrance"
    ],
    "answer": "Here's Johnny!",
    "answer_annotation": "Spoken by Jack Nicholson as Jack Torrance from the movie The Shining",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "i_see_dead_people": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie The Sixth Sense",
      "Spoken by Haley Joel Osment as Cole Sear"
    ],
    "answer": "I see dead people",
    "answer_annotation": "Spoken by Haley Joel Osment as Cole Sear from the movie The Sixth Sense",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "run_forrest_run": {
    "accent": "Russian",
    "hints": [
      "Quote from the movie Forrest Gump",
      "Spoken by Tom Hanks as Forrest Gump"
    ],
    "answer": "Run Forrest Run!",
    "answer_annotation": "Spoken by Tom Hanks as Forrest Gump from the movie Forrest Gump",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "its_only_after_weve_lost_everything_that_were_free_to_do_anything": {
    "accent": "Swedish",
    "hints": [
      "Quote from the movie Fight Club",
      "Spoken by Brad Pitt as Tyler Durden"
    ],
    "answer": "It's only after we've lost everything that we're free to do anything",
    "answer_annotation": "Spoken by Brad Pitt as Tyler Durden from the movie Fight Club",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "mama_says_stupid_is_as_stupid_does": {
    "accent": "Danish",
    "hints": [
      "Quote from the movie Forrest Gump",
      "Spoken by Tom Hanks as Forrest Gump"
    ],
    "answer": "Mama says Stupid is as stupid does",
    "answer_annotation": "Spoken by Tom Hanks as Forrest Gump from the movie Forrest Gump",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "be_afraid_be_very_afraid": {
    "accent": "Japanese",
    "hints": [
      "Quote from the movie The Fly",
      "Spoken by Geena Davis as Veronica 'Ronnie' Quaife"
    ],
    "answer": "Be afraid Be very afraid",
    "answer_annotation": "Spoken by Geena Davis as Veronica 'Ronnie' Quaife from the movie The Fly",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "oh_what_a_day_what_a_lovely_day": {
    "accent": "Russian",
    "hints": [
      "Quote from the movie Mad Max: Fury Road",
      "Spoken by Nicholas Hoult as Nux"
    ],
    "answer": "Oh what a day What a lovely day!",
    "answer_annotation": "Spoken by Nicholas Hoult as Nux from the movie Mad Max: Fury Road",
    "type": "Movie Quotes",
    "difficulty": "3"
  },
  "i_love_the_smell_napalm_in_the_morning": {
    "accent": "Welsh",
    "hints": [
      "Quote from the movie Apocalypse Now",
      "Spoken by Robert Duvall as Lieutenant Colonel William 'Bill' Kilgore"
    ],
    "answer": "I love the smell of napalm in the morning",
    "answer_annotation": "Spoken by Robert Duvall as Lieutenant Colonel William 'Bill' Kilgore from the movie Apocalypse Now",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "i_solemnly_swear_i_am_up_to_no_good": {
    "accent": "Castilian Spanish",
    "hints": [
      "Quote from the movie Harry Potter and the Prisoner of Azkaban",
      "Phrase that allows a person to see what is on the Marauder's Map"
    ],
    "answer": "I solemnly swear I am up to no good",
    "answer_annotation": "Spoken by various characters from the movie Harry Potter and the Prisoner of Azkaban",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "remember_who_you_are": {
    "accent": "Norwegian",
    "hints": [
      "Quote from the movie The Lion King",
      "Spoken by James Earl Jones as Mufasa"
    ],
    "answer": "Remember who you are",
    "answer_annotation": "Spoken by James Earl Jones as Mufasa from the movie The Lion King",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "do_you_wanna_build_a_snowman": {
    "accent": "Danish",
    "hints": [
      "Quote from the movie Frozen",
      "Spoken by Kristen Bell as Anna"
    ],
    "answer": "Do you wanna build a snowman?",
    "answer_annotation": "Spoken by Kristen Bell as Anna from the movie Frozen",
    "type": "Movie Quotes",
    "difficulty": "4"
  },
  "some_people_are_worth_melting_for": {
    "accent": "Polish",
    "hints": [
      "Quote from the movie Frozen",
      "Spoken by Josh Gad as Olaf"
    ],
    "answer": "Some people are worth melting for",
    "answer_annotation": "Spoken by Josh Gad as Olaf from the movie Frozen",
    "type": "Movie Quotes",
    "difficulty": "5"
  },
  "our_fate_lives_within_us_you_only_have_to_be_brave_enough_to_see_it": {
    "accent": "Castilian Spanish",
    "hints": [
      "Quote from the movie Brave",
      "Spoken by Kelly Macdonald as Merida"
    ],
    "answer": "Our fate lives within us You only have to be brave enough to see it",
    "answer_annotation": "Spoken by Kelly Macdonald as Merida from the movie Brave",
    "type": "Movie Quotes",
    "difficulty": "6"
  },
  "i_never_look_back_darling_it_distracts_me_from_the_now": {
    "accent": "Portuguese",
    "hints": [
      "Quote from the movie The Incredibles",
      "Spoken by Brad Bird as Edna Mode"
    ],
    "answer": "I never look back darling It distracts me from the now",
    "answer_annotation": "Spoken by Brad Bird as Edna Mode from the movie The Incredibles",
    "type": "Movie Quotes",
    "difficulty": "7"
  },
  "i_dont_want_to_survive_i_want_to_live": {
    "accent": "Korean",
    "hints": [
      "Quote from the movie Wall-E",
      "Quote from the movie Twelve Years A Slave",
      "Spoken by Jeff Garlin as Captain B. McCrea",
      "Spoken by Chiwetel Ejiofor as Solomon Northup"
    ],
    "answer": "I don't want to survive I want to live",
    "answer_annotation": "Spoken by Jeff Garlin as Captain B. McCrea from the movie Wall-E and by Chiwetel Ejiofor as Solomon Northup from the movie Twelve Years A Slave",
    "type": "Movie Quotes",
    "difficulty": "7"
  }
};


__languages.default.jsonFiles = {
  'database.json': jsonSourceFiles['database.json']
};

  /*
   * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
   * SPDX-License-Identifier: Apache-2.0
   * ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   */
var enableStateTracing, handlerSteps, logStateTraces, loggingLevel, ref, ref1, ref2, ref3, ref4, ref5, ref6, ref7, ref8, shouldUniqueURLs,
  indexOf = [].indexOf;

// causes every request and response object to be written to the logs
loggingLevel = (ref = typeof process !== "undefined" && process !== null ? (ref1 = process.env) != null ? ref1.loggingLevel : void 0 : void 0) != null ? ref : null;

// when enabled, logs out every state transition when it happens, useful for tracing what
// order things happened in  when something goes wrong
logStateTraces = (ref2 = typeof process !== "undefined" && process !== null ? (ref3 = process.env) != null ? ref3.logStateTraces : void 0 : void 0) === 'true' || ref2 === true;

enableStateTracing = ((ref4 = typeof process !== "undefined" && process !== null ? (ref5 = process.env) != null ? ref5.enableStateTracing : void 0 : void 0) === 'true' || ref4 === true) || logStateTraces;

// hack for over aggressive Show caching
shouldUniqueURLs = (typeof process !== "undefined" && process !== null ? (ref6 = process.env) != null ? ref6.shouldUniqueURLs : void 0 : void 0) === 'true';

// assets root location is determined by an external variable
litexa.assetsRoot = (ref7 = typeof process !== "undefined" && process !== null ? (ref8 = process.env) != null ? ref8.assetsRoot : void 0 : void 0) != null ? ref7 : litexa.assetsRoot;

handlerSteps = {};

exports.handler = function(event, lambdaContext, callback) {
  var handlerContext;
  handlerContext = {
    originalEvent: event,
    litexa: litexa
  };
  // patch for testing support to be able to toggle this without
  // recreating the lambda
  if (event.__logStateTraces != null) {
    logStateTraces = event.__logStateTraces;
  }
  switch (loggingLevel) {
    case 'verbose':
      // when verbose logging, dump the whole event to the console
      // this is pretty quick, but it makes for massive logs
      exports.Logging.log("VERBOSE REQUEST " + JSON.stringify(event, null, 2));
      break;
    case 'terse':
      exports.Logging.log("VERBOSE REQUEST " + JSON.stringify(event.request, null, 2));
  }
  // patch when missing so downstream doesn't have to check
  if (event.session == null) {
    event.session = {};
  }
  if (event.session.attributes == null) {
    event.session.attributes = {};
  }
  return handlerSteps.extractIdentity(event, handlerContext).then(function() {
    return handlerSteps.checkFastExit(event, handlerContext);
  }).then(function(proceed) {
    if (!proceed) {
      return callback(null, {});
    }
    return handlerSteps.runConcurrencyLoop(event, handlerContext).then(async function(response) {
      var err, events, extensionName, promise;
      // if we have post process extensions, then run each one in series
      promise = Promise.resolve();
      for (extensionName in extensionEvents) {
        events = extensionEvents[extensionName];
        if (events.beforeFinalResponse != null) {
          try {
            await events.beforeFinalResponse(response);
          } catch (error) {
            err = error;
            exports.Logging.error(`Failed to execute the beforeFinalResponse event for extension ${extensionName}: ${err}`);
            throw err;
          }
        }
      }
      return response;
    }).then(function(response) {
      // if we're fully resolved here, we can return the final result
      if (loggingLevel) {
        exports.Logging.log("VERBOSE RESPONSE " + JSON.stringify(response, null, 2));
      }
      return callback(null, response);
    }).catch(function(err) {
      // otherwise, we've failed, so return as an error, without data
      return callback(err, null);
    });
  });
};

handlerSteps.extractIdentity = function(event, handlerContext) {
  return new Promise(function(resolve, reject) {
    var identity, ref10, ref11, ref12, ref13, ref14, ref9;
    // extract the info we consider to be the user's identity. Note
    // different events may provide this information in different places
    handlerContext.identity = identity = {};
    if (((ref9 = event.context) != null ? ref9.System : void 0) != null) {
      identity.requestAppId = (ref10 = event.context.System.application) != null ? ref10.applicationId : void 0;
      identity.userId = (ref11 = event.context.System.user) != null ? ref11.userId : void 0;
      identity.deviceId = (ref12 = event.context.System.device) != null ? ref12.deviceId : void 0;
    } else if (event.session != null) {
      identity.requestAppId = (ref13 = event.session.application) != null ? ref13.applicationId : void 0;
      identity.userId = (ref14 = event.session.user) != null ? ref14.userId : void 0;
      identity.deviceId = 'no-device';
    }
    return resolve();
  });
};

handlerSteps.checkFastExit = function(event, handlerContext) {
  var terminalEvent;
  // detect fast exit for valid events we don't route yet, or have no response to
  terminalEvent = false;
  switch (event.request.type) {
    case 'System.ExceptionEncountered':
      exports.Logging.error(`ERROR System.ExceptionEncountered: ${JSON.stringify(event.request)}`);
      terminalEvent = true;
      break;
    case 'SessionEndedRequest':
      terminalEvent = true;
  }
  if (!terminalEvent) {
    return true;
  }
  // this is an event that ends the session, but we may have code
  // that needs to cleanup on skill exist that result in a BD write
  return new Promise(function(resolve, reject) {
    var tryToClose;
    tryToClose = function() {
      var dbKey;
      dbKey = litexa.overridableFunctions.generateDBKey(handlerContext.identity);
      return db.fetchDB({
        identity: handlerContext.identity,
        dbKey,
        fetchCallback: function(err, dbObject) {
          if (err != null) {
            return reject(err);
          }
          // todo, insert any new skill cleanup code here
          //   check to see if dbObject needs flushing

          // all clear, we don't have anything active
          if (loggingLevel) {
            exports.Logging.log("VERBOSE Terminating input handler early");
          }
          return resolve(false);
          // write back the object, to clear our memory
          return dbObject.finalize(function(err) {
            if (err != null) {
              return reject(err);
            }
            if (dbObject.repeatHandler) {
              return tryToClose();
            } else {
              return resolve(false);
            }
          });
        }
      });
    };
    return tryToClose();
  });
};

handlerSteps.runConcurrencyLoop = function(event, handlerContext) {
  // to solve for concurrency, we keep state in a database
  // and support retrying all the logic after this point
  // in the event that the database layer detects a collision
  return new Promise(async function(resolve, reject) {
    var lang, langCode, language, numberOfTries, ref9, requestTimeStamp, runHandler;
    numberOfTries = 0;
    requestTimeStamp = (new Date((ref9 = event.request) != null ? ref9.timestamp : void 0)).getTime();
    // work out the language, from the locale, if it exists
    language = 'default';
    if (event.request.locale != null) {
      lang = event.request.locale.toLowerCase();
      langCode = lang.slice(0, 2);
      if (lang in __languages) {
        language = lang;
      } else if (langCode in __languages) {
        language = langCode;
      }
    }
    litexa.language = language;
    handlerContext.identity.litexaLanguage = language;
    runHandler = function() {
      var dbKey;
      numberOfTries += 1;
      if (numberOfTries > 1) {
        exports.Logging.log(`CONCURRENCY LOOP iteration ${numberOfTries}, denied db write`);
      }
      dbKey = litexa.overridableFunctions.generateDBKey(handlerContext.identity);
      return db.fetchDB({
        identity: handlerContext.identity,
        dbKey,
        fetchCallback: async function(err, dbObject) {
          var base, ref10, ref11, response, stateContext;
          try {
            // build the context object for the state machine
            stateContext = {
              say: [],
              reprompt: [],
              directives: [],
              shouldEndSession: false,
              now: requestTimeStamp,
              settings: {},
              traceHistory: [],
              requestId: event.request.requestId,
              language: language,
              event: event,
              request: (ref10 = event.request) != null ? ref10 : {},
              db: new DBTypeWrapper(dbObject, language)
            };
            stateContext.settings = (ref11 = stateContext.db.read("__settings")) != null ? ref11 : {
              resetOnLaunch: true
            };
            if (!dbObject.isInitialized()) {
              dbObject.initialize();
              await (typeof (base = __languages[stateContext.language].enterState).initialize === "function" ? base.initialize(stateContext) : void 0);
            }
            await handlerSteps.parseRequestData(stateContext);
            await handlerSteps.initializeMonetization(stateContext, event);
            await handlerSteps.routeIncomingIntent(stateContext);
            await handlerSteps.walkStates(stateContext);
            response = (await handlerSteps.createFinalResult(stateContext));
            if (event.__reportStateTrace) {
              response.__stateTrace = stateContext.traceHistory;
            }
            if (dbObject.repeatHandler) {
              // the db failed to save, repeat the whole process
              return (await runHandler());
            } else {
              return resolve(response);
            }
          } catch (error) {
            err = error;
            return reject(err);
          }
        }
      });
    };
    // kick off the first one
    return (await runHandler());
  });
};

handlerSteps.parseRequestData = function(stateContext) {
  var auth, extensionName, func, handled, incomingState, intent, isColdLaunch, name, obj, ref10, ref11, ref12, ref13, ref14, ref15, ref16, ref17, ref18, ref9, request, requests, value;
  request = stateContext.request;
  // this is litexa's dynamic request context, i.e. accesible from litexa as $something
  stateContext.slots = {
    request: request
  };
  stateContext.oldInSkillProducts = stateContext.inSkillProducts = (ref9 = stateContext.db.read("__inSkillProducts")) != null ? ref9 : {
    inSkillProducts: []
  };
  // note:
  // stateContext.handoffState  : who will handle the next intent
  // stateContext.handoffIntent : which intent will be delivered next
  // stateContext.currentState  : which state are we ALREADY in
  // stateContext.nextState     : which state is queued up to be transitioned into next
  stateContext.handoffState = null;
  stateContext.handoffIntent = false;
  stateContext.currentState = stateContext.db.read("__currentState");
  stateContext.nextState = null;
  if (request.type === 'LaunchRequest') {
    reportValueMetric('Launches');
  }
  switch (request.type) {
    case 'IntentRequest':
    case 'LaunchRequest':
      incomingState = stateContext.currentState;
      // don't have a current state? Then we're going to launch
      if (!incomingState) {
        incomingState = 'launch';
        stateContext.currentState = null;
      }
      isColdLaunch = request.type === 'LaunchRequest' || ((ref10 = stateContext.event.session) != null ? ref10.new : void 0);
      if (stateContext.settings.resetOnLaunch && isColdLaunch) {
        incomingState = 'launch';
        stateContext.currentState = null;
      }
      if (request != null ? request.intent : void 0) {
        intent = request.intent;
        stateContext.intent = intent.name;
        if (intent.slots != null) {
          ref11 = intent.slots;
          for (name in ref11) {
            obj = ref11[name];
            stateContext.slots[name] = obj.value;
            auth = (ref12 = obj.resolutions) != null ? (ref13 = ref12.resolutionsPerAuthority) != null ? ref13[0] : void 0 : void 0;
            if ((auth != null) && ((ref14 = auth.status) != null ? ref14.code : void 0) === 'ER_SUCCESS_MATCH') {
              value = (ref15 = auth.values) != null ? (ref16 = ref15[0]) != null ? (ref17 = ref16.value) != null ? ref17.name : void 0 : void 0 : void 0;
              if (value != null) {
                stateContext.slots[name] = value;
              }
            }
          }
        }
        stateContext.handoffIntent = true;
        stateContext.handoffState = incomingState;
        stateContext.nextState = null;
      } else {
        stateContext.intent = null;
        stateContext.handoffIntent = false;
        stateContext.handoffState = null;
        stateContext.nextState = incomingState;
      }
      break;
    case 'Connections.Response':
      stateContext.handoffIntent = true;
      // if we get this and we're not in progress,
      // then reroute to the launch state
      if (stateContext.currentState != null) {
        stateContext.handoffState = stateContext.currentState;
      } else {
        stateContext.nextState = 'launch';
        stateContext.handoffState = 'launch';
      }
      break;
    default:
      stateContext.intent = request.type;
      stateContext.handoffIntent = true;
      stateContext.handoffState = stateContext.currentState;
      stateContext.nextState = null;
      handled = false;
      for (extensionName in extensionRequests) {
        requests = extensionRequests[extensionName];
        if (request.type in requests) {
          handled = true;
          func = requests[request.type];
          if (typeof func === 'function') {
            func(request);
          }
        }
      }
      if (ref18 = request.type, indexOf.call(litexa.extendedEventNames, ref18) >= 0) {
        handled = true;
      }
      if (!handled) {
        throw new Error(`unrecognized event type: ${request.type}`);
      }
  }
  return initializeExtensionObjects(stateContext);
};

handlerSteps.initializeMonetization = function(stateContext, event) {
  var attributes, ref10, ref11, ref9;
  stateContext.monetization = stateContext.db.read("__monetization");
  if (stateContext.monetization == null) {
    stateContext.monetization = {
      fetchEntitlements: false,
      inSkillProducts: []
    };
    stateContext.db.write("__monetization", stateContext.monetization);
  }
  if ((ref9 = (ref10 = event.request) != null ? ref10.type : void 0) === 'Connections.Response' || ref9 === 'LaunchRequest') {
    attributes = event.session.attributes;
    // invalidate monetization cache
    stateContext.monetization.fetchEntitlements = true;
    stateContext.db.write("__monetization", stateContext.monetization);
  }
  if (((ref11 = event.request) != null ? ref11.type : void 0) === 'Connections.Response') {
    stateContext.intent = 'Connections.Response';
    stateContext.handoffIntent = true;
    stateContext.handoffState = 'launch';
    stateContext.nextState = 'launch';
  }
  return Promise.resolve();
};

handlerSteps.routeIncomingIntent = async function(stateContext) {
  var base, i, item, j, name1;
  if (stateContext.nextState) {
    if (!(stateContext.nextState in __languages[stateContext.language].enterState)) {
      // we've been asked to execute a non existant state!
      // in order to have a chance at recovering, we have to drop state
      // which means when next we launch we'll start over

      // todo: reroute to launch anyway?
      await new Promise(function(resolve, reject) {
        stateContext.db.write("__currentState", null);
        return stateContext.db.finalize(function(err) {
          return reject(new Error(`Invalid state name \`${stateContext.nextState}\``));
        });
      });
    }
  }
// if we have an intent, handle it with the current state
// but if that handler sets a handoff, then following that
// and keep following them until we've actually handled it
  for (i = j = 0; j < 10; i = ++j) {
    if (!stateContext.handoffIntent) {
      return;
    }
    stateContext.handoffIntent = false;
    if (enableStateTracing) {
      item = `${stateContext.handoffState}:${stateContext.intent}`;
      stateContext.traceHistory.push(item);
    }
    if (logStateTraces) {
      item = `drain intent ${stateContext.intent} in ${stateContext.handoffState}`;
      exports.Logging.log("STATETRACE " + item);
    }
    await (typeof (base = __languages[stateContext.language].processIntents)[name1 = stateContext.handoffState] === "function" ? base[name1](stateContext) : void 0);
  }
  throw new Error("Intent handler recursion error, exceeded 10 steps");
};

handlerSteps.walkStates = async function(stateContext) {
  var MaximumTransitionCount, base, i, item, j, lastState, name1, nextState, ref9;
  // keep processing state transitions until we're done
  MaximumTransitionCount = 500;
  for (i = j = 0, ref9 = MaximumTransitionCount; (0 <= ref9 ? j < ref9 : j > ref9); i = 0 <= ref9 ? ++j : --j) {
    nextState = stateContext.nextState;
    stateContext.nextState = null;
    if (!nextState) {
      return;
    }
    lastState = stateContext.currentState;
    stateContext.currentState = nextState;
    if (lastState != null) {
      await __languages[stateContext.language].exitState[lastState](stateContext);
    }
    if (enableStateTracing) {
      stateContext.traceHistory.push(nextState);
    }
    if (logStateTraces) {
      item = `enter ${nextState}`;
      exports.Logging.log("STATETRACE " + item);
    }
    if (!(nextState in __languages[stateContext.language].enterState)) {
      throw new Error(`Transitioning to an unknown state \`${nextState}\``);
    }
    await __languages[stateContext.language].enterState[nextState](stateContext);
    if (stateContext.handoffIntent) {
      stateContext.handoffIntent = false;
      if (enableStateTracing) {
        stateContext.traceHistory.push(stateContext.handoffState);
      }
      if (logStateTraces) {
        exports.Logging.log("STATETRACE " + item);
      }
      await (typeof (base = __languages[stateContext.language].processIntents)[name1 = stateContext.handoffState] === "function" ? base[name1](stateContext) : void 0);
    }
  }
  exports.Logging.error(`States error: exceeded ${MaximumTransitionCount} transitions.`);
  if (enableStateTracing) {
    exports.Logging.error(`States visited: [${stateContext.traceHistory.join(' -> ')}]`);
  } else {
    exports.Logging.error("Set 'enableStateTracing' to get a history of which states were visited.");
  }
  throw new Error(`States error: exceeded ${MaximumTransitionCount} transitions. Check your logic for non-terminating loops.`);
};

handlerSteps.createFinalResult = async function(stateContext) {
  var card, content, d, err, events, extensionName, hasDisplay, joinSpeech, keep, parts, ref10, ref11, ref12, ref13, ref14, ref15, ref16, ref17, ref18, ref19, ref20, ref9, response, s, stripSSML, title, wrapper;
  stripSSML = function(line) {
    if (line == null) {
      return void 0;
    }
    line = line.replace(/<[^>]+>/g, '');
    return line.replace(/[ ]+/g, ' ');
  };
// invoke any 'afterStateMachine' extension events
  for (extensionName in extensionEvents) {
    events = extensionEvents[extensionName];
    try {
      await (typeof events.afterStateMachine === "function" ? events.afterStateMachine() : void 0);
    } catch (error) {
      err = error;
      exports.Logging.error(`Failed to execute afterStateMachine for extension ${extensionName}: ${err}`);
      throw err;
    }
  }
  hasDisplay = ((ref9 = stateContext.event.context) != null ? (ref10 = ref9.System) != null ? (ref11 = ref10.device) != null ? (ref12 = ref11.supportedInterfaces) != null ? ref12.Display : void 0 : void 0 : void 0 : void 0) != null;
  // start building the final response json object
  wrapper = {
    version: "1.0",
    sessionAttributes: {},
    userAgent: userAgent, // this userAgent value is generated in project-info.coffee and injected in skill.coffee
    response: {
      shouldEndSession: stateContext.shouldEndSession
    }
  };
  response = wrapper.response;
  if (stateContext.shouldDropSession) {
    delete response.shouldEndSession;
  }
  // build outputSpeech and reprompt from the accumulators
  joinSpeech = function(arr) {
    var j, len, mapping, ref13, result;
    result = arr.join(' ');
    result = result.replace(/(  )/g, ' ');
    ref13 = litexa.sayMapping;
    for (j = 0, len = ref13.length; j < len; j++) {
      mapping = ref13[j];
      result = result.replace(mapping.test, mapping.change);
    }
    return result;
  };
  if ((stateContext.say != null) && stateContext.say.length > 0) {
    response.outputSpeech = {
      type: "SSML",
      ssml: `<speak>${joinSpeech(stateContext.say)}</speak>`,
      playBehavior: "REPLACE_ALL"
    };
  }
  if (stateContext.repromptTheSay) {
    stateContext.reprompt = (ref13 = stateContext.reprompt) != null ? ref13 : [];
    response.reprompt = {
      outputSpeech: {
        type: "SSML",
        ssml: `<speak>${joinSpeech(stateContext.reprompt)} ${joinSpeech(stateContext.say)}</speak>`
      }
    };
  } else if ((stateContext.reprompt != null) && stateContext.reprompt.length > 0) {
    response.reprompt = {
      outputSpeech: {
        type: "SSML",
        ssml: `<speak>${joinSpeech(stateContext.reprompt)}</speak>`
      }
    };
  }
  if (stateContext.card != null) {
    card = stateContext.card;
    title = (ref14 = card.title) != null ? ref14 : "";
    content = (ref15 = card.content) != null ? ref15 : "";
    if (card.repeatSpeech && (stateContext.say != null)) {
      parts = (function() {
        var j, len, ref16, results;
        ref16 = stateContext.say;
        results = [];
        for (j = 0, len = ref16.length; j < len; j++) {
          s = ref16[j];
          results.push(stripSSML(s));
        }
        return results;
      })();
      content += parts.join('\n');
    }
    content = content != null ? content : "";
    response.card = {
      type: "Simple",
      title: title != null ? title : ""
    };
    response.card.title = response.card.title.trim();
    if (card.imageURLs != null) {
      response.card.type = "Standard";
      response.card.text = content != null ? content : "";
      response.card.image = {
        smallImageUrl: card.imageURLs.cardSmall,
        largeImageUrl: card.imageURLs.cardLarge
      };
      response.card.text = response.card.text.trim();
    } else {
      response.card.type = "Simple";
      response.card.content = content;
      response.card.content = response.card.content.trim();
    }
    keep = false;
    if (response.card.title.length > 0) {
      keep = true;
    }
    if (((ref16 = response.card.text) != null ? ref16.length : void 0) > 0) {
      keep = true;
    }
    if (((ref17 = response.card.content) != null ? ref17.length : void 0) > 0) {
      keep = true;
    }
    if (((ref18 = response.card.image) != null ? ref18.smallImageUrl : void 0) != null) {
      keep = true;
    }
    if (((ref19 = response.card.image) != null ? ref19.largeImageUrl : void 0) != null) {
      keep = true;
    }
    if (!keep) {
      delete response.card;
    }
  }
  if (stateContext.musicCommand != null) {
    stateContext.directives = (ref20 = stateContext.directives) != null ? ref20 : [];
    switch (stateContext.musicCommand.action) {
      case 'play':
        stateContext.directives.push({
          type: "AudioPlayer.Play",
          playBehavior: "REPLACE_ALL",
          audioItem: {
            stream: {
              url: stateContext.musicCommand.url,
              token: "no token",
              offsetInMilliseconds: 0
            }
          }
        });
        break;
      case 'stop':
        stateContext.directives.push({
          type: "AudioPlayer.Stop"
        });
    }
  }
  // store current state for next time, unless we're intentionally ending
  if (stateContext.shouldEndSession) {
    stateContext.currentState = null;
  }
  if (stateContext.currentState === null) {
    response.shouldEndSession = true;
  }
  stateContext.db.write("__currentState", stateContext.currentState);
  stateContext.db.write("__settings", stateContext.settings);
  // filter out any directives that were marked for removal
  stateContext.directives = (function() {
    var j, len, ref21, results;
    ref21 = stateContext.directives;
    results = [];
    for (j = 0, len = ref21.length; j < len; j++) {
      d = ref21[j];
      if (!d.DELETEME) {
        results.push(d);
      }
    }
    return results;
  })();
  if ((stateContext.directives != null) && stateContext.directives.length > 0) {
    response.directives = stateContext.directives;
  }
  return (await new Promise(function(resolve, reject) {
    return stateContext.db.finalize(function(err, info) {
      if (err != null) {
        if (!db.repeatHandler) {
          reject(err);
        }
      }
      return resolve(wrapper);
    });
  }));
};

(function( __language ) {
var enterState = __language.enterState;
var processIntents = __language.processIntents;
var exitState = __language.exitState;
var dataTables = __language.dataTables;
var jsonFiles = __language.jsonFiles;
var seenSpeechBefore = {};
var seenHintsBefore = {};

class Master {
	constructor() {
		this.database = jsonFiles['database.json'];
		this.seenSpeechBefore = seenSpeechBefore;
		this.seenHintsBefore = seenHintsBefore;
	}

	seen(speechKey) {
		console.log('seen');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		this.seenSpeechBefore[speechKey] = true;
	}

	speechAvailable() {
		console.log('speechAvailable');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		var availableKeys = Object.keys(jsonFiles['database.json']);
		var seenKeys = Object.keys(this.seenSpeechBefore);
		if ((availableKeys.length - seenKeys.length) <= 0) {
			return false;
		}
		return true;
	}

	seenBefore(speechKey) {
		console.log('seenBefore');
		console.log(this.seenSpeechBefore);
		if (!this.seenSpeechBefore) {
			this.seenSpeechBefore = {};
		}

		if (speechKey in this.seenSpeechBefore) {
			return true;
		} else {
			return false;
		}
	}

	seenHint(speechKey, hint) {
		console.log('seenHint');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
		}

		if (!(speechKey in this.seenHintsBefore)) {
			this.seenHintsBefore[speechKey] = {};
		}
		this.seenHintsBefore[speechKey][hint] = true;
	}

	hintAvailable(speechKey) {
		console.log('hintAvailable');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
			return true;
		}

		if (!(speechKey in this.seenHintsBefore)) {
			return true;
		}

		var availableHints = jsonFiles['database.json'][speechKey]['hints'];
		var seenHints = Object.keys(this.seenHintsBefore[speechKey]);

		if ((availableHints.length - seenHints.length) <= 0) {
			return false;
		}
		return true;
	}

	seenHintBefore(speechKey, hint) {
		console.log('seenHintBefore');
		console.log(this.seenHintsBefore);

		if (!this.seenHintsBefore) {
			this.seenHintsBefore = {};
			return false;
		}

		if (!(speechKey in this.seenHintsBefore)) {
			return false;
		}
		if (hint in this.seenHintsBefore[speechKey]) {
			return true;
		} else {
			return false;
		}
	}

	getRandomIndex() {
		return Math.floor(Math.random() * Math.floor(Object.keys(jsonFiles['database.json']).length));
	}

	getRandomSpeech() {
		var keys = Object.keys(jsonFiles['database.json']);
		var randomProp = keys[this.getRandomIndex()];
		// console.log(keys);
		// console.log(randomProp);
		this.speechKey = randomProp;
		return randomProp;

	}

	getAccent(speechKey) {
		return jsonFiles['database.json'][speechKey]['accent'];
	}

	getAnswer(speechKey) { // String
		// console.log(this.speechKey);
		return jsonFiles['database.json'][speechKey]['answer'];
	}

	getAnnotation(speechKey) {
		return jsonFiles['database.json'][speechKey]['answer_annotation'];
	}

	getHint(speechKey) {  // String
		var hints = jsonFiles['database.json'][speechKey]['hints'];
		var randomHint = hints[Math.floor(Math.random() * Math.floor(hints.length))];
		console.log(hints);
		console.log(randomHint);
		return randomHint;
	}

	// validateAnswer(answer, speechKey) {

	// }
}

exports.getPotentialAnswers = function() {
	return {
		name: 'ANSWER_LIST',
		values: [
			"I'll be back",
			"Luke I am your father",
			"I'm going to make him an offer he can't refuse",
			"May the force be with you",
			"You talking to me",
			"Frankly my dear I don't give a damn",
			"Go ahead make my day",
			"Bond James Bond",
			"Show me the money",
			"You can't handle the truth",
			"Houston we have a problem",
			"Elementary my dear Watson",
			"Hasta la vista baby",
			"My precious",
			"I am Groot",
			"I want to play a game",
			"This is Sparta",
			"You're a wizard Harry",
			"Just keep swimming",
			"I volunteer as tribute",
			"With great power comes great responsibility",
			"You will ride eternal shiny and chrome",
			"Honey Where is my super suit",
			"Why so serious",
			"You shall not pass",
			"Are you not entertained",
			"You sit on a throne of lies",
			"I live my life a quarter mile at a time",
			"I can do this all day",
			"ET Phone home",
			"Rosebud",
			"There's no place like home",
			"Say hello to my little friend",
			"A martini Shaken not stirred",
			"Mama always said life was like a box of chocolates You never know what you're gonna get",
			"Love means never having to say you're sorry",
			"They may take our lives but they'll never take our freedom!",
			"Oh my god I am totally bugging!",
			"Magic Mirror on the wall who is the fairest one of all?",
			"Wax on wax off",
			"Alright alright alright",
			"The Dude abides",
			"That is so fetch!",
			"Stop trying to make fetch happen It's not going to happen",
			"On Wednesdays we wear pink",
			"Get in loser we're going shopping",
			"Why don't you make like a tree and get outta here",
			"Roads Where we're going we don't need roads",
			"Fasten your seatbelts It's going to be a bumpy night",
			"To infinity and beyond!",
			"No capes!",
			"Not everyone can become a great artist but a great artist can come from anywhere",
			"Fish are friends not food",
			"You're gonna need a bigger boat",
			"You're embarrassing me in front of the wizards",
			"I'm batman",
			"It’s not who I am underneath but what I do that defines me",
			"Some men just want to watch the world burn",
			"You mustn't be afraid to dream a little bigger darling",
			"I wish I knew how to quit you",
			"I am Iron Man",
			"I'm a dude playing a dude disguised as another dude!",
			"Get busy living or get busy dying",
			"How do you like them apples?",
			"We all float down here",
			"Terrified mortified petrified stupified by you",
			"Do or do not There is no try",
			"I'm king of the world",
			"I'll get you my pretty and your little dog too!",
			"I feel the need the need for speed!",
			"Here's Johnny!",
			"I see dead people",
			"Run Forrest Run!",
			"It's only after we've lost everything that we're free to do anything",
			"Mama says Stupid is as stupid does",
			"Be afraid Be very afraid",
			"Oh what a day What a lovely day!",
			"I love the smell of napalm in the morning",
			"I solemnly swear I am up to no good",
			"Remember who you are",
			"Do you wanna build a snowman?",
			"Some people are worth melting for",
			"Our fate lives within us You only have to be brave enough to see it",
			"I never look back darling It distracts me from the now",
			"I don't want to survive I want to live"
		]
	};
}
!function(e,t){for(var r in t)e[r]=t[r]}(global,function(e){var t={};function r(n){if(t[n])return t[n].exports;var i=t[n]={i:n,l:!1,exports:{}};return e[n].call(i.exports,i,i.exports,r),i.l=!0,i.exports}return r.m=e,r.c=t,r.d=function(e,t,n){r.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})},r.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},r.t=function(e,t){if(1&t&&(e=r(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var n=Object.create(null);if(r.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var i in e)r.d(n,i,function(t){return e[t]}.bind(null,i));return n},r.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return r.d(t,"a",t),t},r.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},r.p="",r(r.s=17)}([function(e,t,r){"use strict";const n=Symbol("pino.setLevel"),i=Symbol("pino.getLevel"),s=Symbol("pino.levelVal"),o=Symbol("pino.useLevelLabels"),a=Symbol("pino.changeLevelName"),c=Symbol("pino.useOnlyCustomLevels"),l=Symbol("pino.lsCache"),u=Symbol("pino.chindings"),h=Symbol("pino.parsedChindings"),f=Symbol("pino.asJson"),p=Symbol("pino.write"),d=Symbol("pino.redactFmt"),y=Symbol("pino.time"),m=Symbol("pino.stream"),g=Symbol("pino.stringify"),v=Symbol("pino.stringifiers"),b=Symbol("pino.end"),_=Symbol("pino.formatOpts"),w=Symbol("pino.messageKeyString"),S=Symbol.for("pino.serializers"),k=Symbol.for("pino.*"),O=Symbol.for("pino.metadata");e.exports={setLevelSym:n,getLevelSym:i,levelValSym:s,useLevelLabelsSym:o,lsCacheSym:l,chindingsSym:u,parsedChindingsSym:h,asJsonSym:f,writeSym:p,serializersSym:S,redactFmtSym:d,timeSym:y,streamSym:m,stringifySym:g,stringifiersSym:v,endSym:b,formatOptsSym:_,messageKeyStringSym:w,changeLevelNameSym:a,wildcardGsym:k,needsMetadataGsym:O,useOnlyCustomLevelsSym:c}},function(e,t,r){"use strict";e.exports=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(\.|\[\])(?:\4|$))$/g},function(e,t,r){"use strict";e.exports=function(e){return e}},function(e,t,r){"use strict";const n=r(32),{mapHttpRequest:i,mapHttpResponse:s}=r(8),o=r(11),a=r(13),{lsCacheSym:c,chindingsSym:l,parsedChindingsSym:u,writeSym:h,messageKeyStringSym:f,serializersSym:p,formatOptsSym:d,endSym:y,stringifiersSym:m,stringifySym:g,needsMetadataGsym:v,wildcardGsym:b,redactFmtSym:_,streamSym:w}=r(0);function S(){}function k(e){var t="",r=0,n=!1,i=255;const s=e.length;if(s>100)return JSON.stringify(e);for(var o=0;o<s&&i>=32;o++)34!==(i=e.charCodeAt(o))&&92!==i||(t+=e.slice(r,o)+"\\",r=o,n=!0);return n?t+=e.slice(r):t=e,i<32?JSON.stringify(e):'"'+t+'"'}function O(e,t,n){if(t&&"function"==typeof t)return x(t(e),n);try{var i=r(6);return i.asMetaWrapper=x,x(i(e),n)}catch(e){throw Error("Missing `pino-pretty` module: `pino-pretty` must be installed separately")}}function x(e,t){var r=!1;return{[v]:!0,lastLevel:0,lastMsg:null,lastObj:null,lastLogger:null,flushSync(){r||(r=!0,t.write(e(Object.assign({level:40,msg:"pino.final with prettyPrint does not support flushing",time:Date.now()},this.chindings()))))},chindings(){const e=this.lastLogger;var t=null;return e?(e.hasOwnProperty(u)?t=e[u]:(t=JSON.parse('{"v":1'+e[l]+"}"),e[u]=t),t):null},write(r){const n=this.lastLogger,i=this.chindings();var s=this.lastTime;s.match(/^\d+/)&&(s=parseInt(s));var o=this.lastObj,a=this.lastMsg,c=null;o instanceof Error&&(a=a||o.message,c={type:"Error",stack:o.stack});const l=Object.assign({level:this.lastLevel,msg:a,time:s},i,o,c),u=n[p],h=Object.keys(u);for(var f,d=0;d<h.length;d++)void 0!==l[f=h[d]]&&(l[f]=u[f](l[f]));const y=n[m][_],g=e("function"==typeof y?y(l):l);void 0!==g&&t.write(g)}}}function j(e,t=0,r=!0){const n=new o(e,t,r);return n.on("error",(function e(t){if("EPIPE"===t.code)return n.write=S,n.end=S,n.flushSync=S,void(n.destroy=S);n.removeListener("error",e),n.emit("error",t)})),n}e.exports={noop:S,buildSafeSonicBoom:j,getPrettyStream:O,asChindings:function(e,t){if(!t)throw Error("missing bindings for child Pino");var r,n,i=e[l];const s=e[g],o=e[m],a=e[p];for(r in a[b]&&(t=a[b](t)),t){if(n=t[r],!0===("level"!==r&&"serializers"!==r&&"customLevels"!==r&&t.hasOwnProperty(r)&&void 0!==n)){if(n=a[r]?a[r](n):n,void 0===(n=(o[r]||s)(n)))continue;i+=',"'+r+'":'+n}}return i},asJson:function(e,t,r,n){const i=null!=e,s=i&&e instanceof Error;t=t||!0!==s?t||void 0:e.message;const o=this[g],a=this[m],u=this[y],h=this[f],d=this[l],v=this[p];var _,w=this[c][r]+n;if(void 0!==t&&(w+=h+k(""+t)),w+=d,!0===i){var S=void 0===e.hasOwnProperty;for(var O in!0===s&&(w+=',"type":"Error"',void 0!==e.stack&&(w+=',"stack":'+o(e.stack))),v[b]&&(e=v[b](e)),e)if(_=e[O],(S||e.hasOwnProperty(O))&&void 0!==_){switch(typeof(_=v[O]?v[O](_):_)){case"undefined":case"function":continue;case"number":!1===Number.isFinite(_)&&(_=null);case"boolean":a[O]&&(_=a[O](_)),w+=',"'+O+'":'+_;continue;case"string":_=(a[O]||k)(_);break;default:_=(a[O]||o)(_)}if(void 0===_)continue;w+=',"'+O+'":'+_}}return w+u},genLog:function(e){return function(t,...r){"object"==typeof t&&null!==t?(t.method&&t.headers&&t.socket?t=i(t):"function"==typeof t.setHeader&&(t=s(t)),this[h](t,n(null,r,this[d]),e)):this[h](null,n(t,r,this[d]),e)}},createArgsNormalizer:function(e){return function(t={},r){if("string"==typeof t?(r=j(t),t={}):"string"==typeof r?r=j(r):(t instanceof o||t.writable||t._writableState)&&(r=t,t=null),"extreme"in(t=Object.assign({},e,t)))throw Error("The extreme option has been removed, use pino.extreme instead");if("onTerminated"in t)throw Error("The onTerminated option has been removed, use pino.final instead");const{enabled:n,prettyPrint:i,prettifier:s,messageKey:a}=t;if(!1===n&&(t.level="silent"),(r=r||process.stdout)===process.stdout&&r.fd>=0&&!function(e){return e.write!==e.constructor.prototype.write}(r)&&(r=j(r.fd)),i){r=O(Object.assign({messageKey:a},i),s,r)}return{opts:t,stream:r}}},final:function(e,t){if(void 0===e||"function"!=typeof e.child)throw Error("expected a pino logger instance");const r=void 0!==t;if(r&&"function"!=typeof t)throw Error("if supplied, the handler parameter should be a function");const n=e[w];if("function"!=typeof n.flushSync)throw Error("final requires a stream that has a flushSync method, such as pino.destination and pino.extreme");const i=new Proxy(e,{get:(e,t)=>t in e.levels.values?(...r)=>{e[t](...r),n.flushSync()}:e[t]});return r?(e=null,...r)=>{try{n.flushSync()}catch(e){}return t(e,i,...r)}:i},stringify:function(e){try{return JSON.stringify(e)}catch(t){return a(e)}}}},function(e,t){e.exports=require("util")},function(e,t,r){"use strict";r.r(t),r.d(t,"Time",(function(){return n}));const n={serverTimeGetDay:(e=new Date)=>e.getDay()}},function(e,t,r){"use strict";const n=r(33),i=r(43),s=r(44),o=r(45),a=r(13),c=r(46),l={default:"USERLVL",60:"FATAL",50:"ERROR",40:"WARN ",30:"INFO ",20:"DEBUG",10:"TRACE"},u={colorize:n.supportsColor,crlf:!1,errorLikeObjectKeys:["err","error"],errorProps:"",levelFirst:!1,messageKey:c.MESSAGE_KEY,translateTime:!1,useMetadata:!1,outputStream:process.stdout};function h(e){return e}e.exports=function(e){const t=Object.assign({},u,e),r=t.crlf?"\r\n":"\n",f="    ",p=t.messageKey,d=t.errorLikeObjectKeys,y=t.errorProps.split(","),m={default:h,60:h,50:h,40:h,30:h,20:h,10:h,message:h};if(t.colorize){const e=new n.constructor({enabled:!0,level:3});m.default=e.white,m[60]=e.bgRed,m[50]=e.red,m[40]=e.yellow,m[30]=e.green,m[20]=e.blue,m[10]=e.grey,m.message=e.cyan}const g=t.search;return function(e){let n;if(u=e,"[object Object]"!==Object.prototype.toString.apply(u)){const t=s(e);if(n=t.value,t.err||!function(e){return e&&e.hasOwnProperty("v")&&1===e.v}(n))return e+r}else n=e;var u;if(g&&!o.search(n,g))return;const h=["pid","hostname","name","level","time","v"];t.translateTime&&(n.time=function(e,t){const r=new Date(e);if(!0===t)return i(r,"UTC:"+c.DATE_FORMAT);{const e=t.toUpperCase();return e.startsWith("SYS:")?i(r,"SYS:STANDARD"===e?c.DATE_FORMAT:t.slice(4)):i(r,"UTC:"+t)}}(n.time,t.translateTime));var v=n.time?`[${n.time}]`:"";const b=l.hasOwnProperty(n.level)?m[n.level](l[n.level]):m.default(l.default);if(t.levelFirst)v=`${b} ${v}`;else{v=`${v&&v+" "}${b}`}(n.name||n.pid||n.hostname)&&(v+=" (",n.name&&(v+=n.name),n.name&&n.pid?v+="/"+n.pid:n.pid&&(v+=n.pid),n.hostname&&(v+=" on "+n.hostname),v+=")");v+=": ",n[p]&&"string"==typeof n[p]&&(v+=m.message(n[p]));if(v+=r,"Error"===n.type&&n.stack){const e=n.stack;let t;if(v+=f+w(e)+r,y&&y.length>0){const e=h.concat([p,"type","stack"]);t="*"===y[0]?Object.keys(n).filter(t=>e.indexOf(t)<0):y.filter(t=>e.indexOf(t)<0);for(var _=0;_<t.length;_++){const e=t[_];n.hasOwnProperty(e)&&(n[e]instanceof Object?v+=e+": {"+r+S(n[e],"",d,!1)+"}"+r:v+=e+": "+n[e]+r)}}}else v+=S(n,"string"==typeof n[p]?p:void 0,d);return v;function w(e){const t=e.split(/\r?\n/);for(var n=1;n<t.length;n++)t[n]=f+t[n];return t.join(r)}function S(e,t,n,i){n=n||[];const s=Object.keys(e),o=[];t&&o.push(t),!1!==i&&Array.prototype.push.apply(o,h);let c="";for(var l=0;l<s.length;l+=1)if(-1!==n.indexOf(s[l])&&void 0!==e[s[l]]){const t=a(e[s[l]],null,2);if(void 0===t)continue;const n=(f+s[l]+": "+w(t)+r).split("\n");for(var u=0;u<n.length;u+=1){0!==u&&(c+="\n");const e=n[u];if(/^\s*"stack"/.test(e)){const t=/^(\s*"stack":)\s*(".*"),?$/.exec(e);if(t&&3===t.length){const r=/^\s*/.exec(e)[0].length+4,n=" ".repeat(r);c+=t[1]+"\n"+n+JSON.parse(t[2]).replace(/\n/g,"\n"+n)}}else c+=e}}else if(o.indexOf(s[l])<0&&void 0!==e[s[l]]){const t=a(e[s[l]],null,2);void 0!==t&&(c+=f+s[l]+": "+w(t)+r)}return c}}}},function(e,t){e.exports=require("os")},function(e,t,r){"use strict";var n=r(18),i=r(19),s=r(20);e.exports={err:n,mapHttpRequest:i.mapHttpRequest,mapHttpResponse:s.mapHttpResponse,req:i.reqSerializer,res:s.resSerializer,wrapErrorSerializer:function(e){return e===n?e:function(t){return e(n(t))}},wrapRequestSerializer:function(e){return e===i.reqSerializer?e:function(t){return e(i.reqSerializer(t))}},wrapResponseSerializer:function(e){return e===s.resSerializer?e:function(t){return e(s.resSerializer(t))}}}},function(e,t,r){"use strict";function n(e,t,r,n,i){var s,o,a,c,l,u=-1,h=r.length,f=h-1,p=null,d=!0;if(a=s=e[t],"object"!=typeof s)return{value:null,parent:null,exists:d};for(;null!=s&&++u<h;){if(p=a,!((t=r[u])in s)){d=!1;break}if(a=s[t],o=i?n(a):n,o=u!==f?a:o,s[t]=(c=s,l=t,Object.prototype.hasOwnProperty.call(c,l)&&o===a||void 0===o&&void 0!==n?s[t]:o),"object"!=typeof(s=s[t]))break}return{value:a,parent:p,exists:d}}function i(e,t){for(var r=-1,n=t.length,i=e;null!=i&&++r<n;)i=i[t[r]];return i}e.exports={groupRedact:function(e,t,r,n){const s=i(e,t);if(null==s)return{keys:null,values:null,target:null,flat:!0};const o=Object.keys(s),a=o.length,c=new Array(a);for(var l=0;l<a;l++){const e=o[l];c[l]=s[e],s[e]=n?r(s[e]):r}return{keys:o,values:c,target:s,flat:!0}},groupRestore:function({keys:e,values:t,target:r}){if(null==r)return;const n=e.length;for(var i=0;i<n;i++){const n=e[i];r[n]=t[i]}},nestedRedact:function(e,t,r,s,o,a){const c=i(t,r);if(null==c)return;const l=Object.keys(c),u=l.length;for(var h=0;h<u;h++){const t=l[h],{value:r,parent:i,exists:u}=n(c,t,s,o,a);!0===u&&null!==i&&e.push({key:s[s.length-1],target:i,value:r})}return e},nestedRestore:function(e){const t=e.length;for(var r=0;r<t;r++){const{key:t,target:n,value:i}=e[r];n[t]=i}}}},function(e,t){e.exports=require("events")},function(e,t,r){"use strict";const n=r(31),i=r(10),s=r(2),o=r(4).inherits,a=16777216;function c(e,t){t._opening=!0,t._writing=!0,t.file=e,n.open(e,"a",(e,r)=>{if(e)t.emit("error",e);else if(t.fd=r,t._reopening=!1,t._opening=!1,t._writing=!1,t.emit("ready"),!t._reopening){var n=t._buf.length;n>0&&n>t.minLength&&!t.destroyed&&h(t)}})}function l(e,t,r){if(!(this instanceof l))return new l(e,t,r);if(this._buf="",this.fd=-1,this._writing=!1,this._writingBuf="",this._ending=!1,this._reopening=!1,this._asyncDrainScheduled=!1,this.file=null,this.destroyed=!1,this.sync=r||!1,this.minLength=t||0,"number"==typeof e)this.fd=e,process.nextTick(()=>this.emit("ready"));else{if("string"!=typeof e)throw new Error("SonicBoom supports only file descriptors and files");c(e,this)}this.release=(e,t)=>{if(e)return"EAGAIN"===e.code?void setTimeout(()=>{n.write(this.fd,this._writingBuf,"utf8",this.release)},100):void this.emit("error",e);if(this._writingBuf.length!==t){if(this._writingBuf=this._writingBuf.slice(t),!this.sync)return void n.write(this.fd,this._writingBuf,"utf8",this.release);try{do{t=n.writeSync(this.fd,this._writingBuf,"utf8"),this._writingBuf=this._writingBuf.slice(t)}while(0!==this._writingBuf.length)}catch(e){return void this.release(e)}}if(this._writingBuf="",!this.destroyed){var r=this._buf.length;this._reopening?(this._writing=!1,this._reopening=!1,this.reopen()):r>0&&r>this.minLength?h(this):this._ending?r>0?h(this):(this._writing=!1,f(this)):(this._writing=!1,this.sync?this._asyncDrainScheduled||(this._asyncDrainScheduled=!0,process.nextTick(u,this)):this.emit("drain"))}}}function u(e){e._asyncDrainScheduled=!1,e.emit("drain")}function h(e){e._writing=!0;var t=e._buf,r=e.release;if(t.length>a?(t=t.slice(0,a),e._buf=e._buf.slice(a)):e._buf="",s(t),e._writingBuf=t,e.sync)try{r(null,n.writeSync(e.fd,t,"utf8"))}catch(e){r(e)}else n.write(e.fd,t,"utf8",r)}function f(e){-1!==e.fd?(n.close(e.fd,t=>{t?e.emit("error",t):(e._ending&&!e._writing&&e.emit("finish"),e.emit("close"))}),e.destroyed=!0,e._buf=""):e.once("ready",f.bind(null,e))}o(l,i),l.prototype.write=function(e){if(this.destroyed)throw new Error("SonicBoom destroyed");this._buf+=e;var t=this._buf.length;return!this._writing&&t>this.minLength&&h(this),t<16384},l.prototype.flush=function(){if(this.destroyed)throw new Error("SonicBoom destroyed");this._writing||this.minLength<=0||h(this)},l.prototype.reopen=function(e){if(this.destroyed)throw new Error("SonicBoom destroyed");if(this._opening)this.once("ready",()=>{this.reopen(e)});else if(!this._ending){if(!this.file)throw new Error("Unable to reopen a file descriptor, you must pass a file to SonicBoom");this._reopening=!0,this._writing||(n.close(this.fd,e=>{if(e)return this.emit("error",e)}),c(e||this.file,this))}},l.prototype.end=function(){if(this.destroyed)throw new Error("SonicBoom destroyed");this._opening?this.once("ready",()=>{this.end()}):this._ending||(this._ending=!0,!this._writing&&this._buf.length>0&&this.fd>=0?h(this):this._writing||f(this))},l.prototype.flushSync=function(){if(this.destroyed)throw new Error("SonicBoom destroyed");if(this.fd<0)throw new Error("sonic boom is not ready yet");this._buf.length>0&&(n.writeSync(this.fd,this._buf,"utf8"),this._buf="")},l.prototype.destroy=function(){this.destroyed||f(this)},e.exports=l},function(e,t,r){"use strict";const n=r(2),{lsCacheSym:i,levelValSym:s,useLevelLabelsSym:o,changeLevelNameSym:a,useOnlyCustomLevelsSym:c}=r(0),{noop:l,genLog:u}=r(3),h={trace:10,debug:20,info:30,warn:40,error:50,fatal:60},f={fatal:u(h.fatal),error:u(h.error),warn:u(h.warn),info:u(h.info),debug:u(h.debug),trace:u(h.trace)},p=Object.keys(h).reduce((e,t)=>(e[h[t]]=t,e),{}),d=Object.keys(p).reduce((e,t)=>(e[t]=n('{"level":'+Number(t)),e),{});function y(e,t){if(t)return!1;switch(e){case"fatal":case"error":case"warn":case"info":case"debug":case"trace":return!0;default:return!1}}e.exports={initialLsCache:d,genLsCache:function(e){const t=e[a];return e[i]=Object.keys(e.levels.labels).reduce((r,i)=>(r[i]=e[o]?`{"${t}":"${e.levels.labels[i]}"`:n(`{"${t}":`+Number(i)),r),e[i]),e},levelMethods:f,getLevel:function(e){const{levels:t,levelVal:r}=this;return t.labels[r]},setLevel:function(e){const{labels:t,values:r}=this.levels;if("number"==typeof e){if(void 0===t[e])throw Error("unknown level value"+e);e=t[e]}if(void 0===r[e])throw Error("unknown level "+e);const n=this[s],i=this[s]=r[e],o=this[c];for(var a in r)i>r[a]?this[a]=l:this[a]=y(a,o)?f[a]:u(r[a]);this.emit("level-change",e,i,t[n],n)},isLevelEnabled:function(e){const{values:t}=this.levels,r=t[e];return void 0!==r&&r>=this[s]},mappings:function(e=null,t=!1){const r=e?Object.keys(e).reduce((t,r)=>(t[e[r]]=r,t),{}):null;return{labels:Object.assign(Object.create(Object.prototype,{Infinity:{value:"silent"}}),t?null:p,r),values:Object.assign(Object.create(Object.prototype,{silent:{value:1/0}}),t?null:h,e)}},assertNoLevelCollisions:function(e,t){const{labels:r,values:n}=e;for(const e in t){if(e in n)throw Error("levels cannot be overridden");if(t[e]in r)throw Error("pre-existing level values cannot be used for new levels")}},assertDefaultLevelFound:function(e,t,r){if("number"==typeof e){if(![].concat(Object.keys(t||{}).map(e=>t[e]),r?[]:Object.keys(p).map(e=>+e),1/0).includes(e))throw Error(`default level:${e} must be included in custom levels`);return}if(!(e in Object.assign(Object.create(Object.prototype,{silent:{value:1/0}}),r?null:h,t)))throw Error(`default level:${e} must be included in custom levels`)}}},function(e,t){e.exports=i,i.default=i,i.stable=o,i.stableStringify=o;var r=[],n=[];function i(e,t,i){var s;for(!function e(t,i,s,o){var a;if("object"==typeof t&&null!==t){for(a=0;a<s.length;a++)if(s[a]===t){var c=Object.getOwnPropertyDescriptor(o,i);return void(void 0!==c.get?c.configurable?(Object.defineProperty(o,i,{value:"[Circular]"}),r.push([o,i,t,c])):n.push([t,i]):(o[i]="[Circular]",r.push([o,i,t])))}if(s.push(t),Array.isArray(t))for(a=0;a<t.length;a++)e(t[a],a,s,t);else{var l=Object.keys(t);for(a=0;a<l.length;a++){var u=l[a];e(t[u],u,s,t)}}s.pop()}}(e,"",[],void 0),s=0===n.length?JSON.stringify(e,t,i):JSON.stringify(e,a(t),i);0!==r.length;){var o=r.pop();4===o.length?Object.defineProperty(o[0],o[1],o[3]):o[0][o[1]]=o[2]}return s}function s(e,t){return e<t?-1:e>t?1:0}function o(e,t,i){var o,c=function e(t,i,o,a){var c;if("object"==typeof t&&null!==t){for(c=0;c<o.length;c++)if(o[c]===t){var l=Object.getOwnPropertyDescriptor(a,i);return void(void 0!==l.get?l.configurable?(Object.defineProperty(a,i,{value:"[Circular]"}),r.push([a,i,t,l])):n.push([t,i]):(a[i]="[Circular]",r.push([a,i,t])))}if("function"==typeof t.toJSON)return;if(o.push(t),Array.isArray(t))for(c=0;c<t.length;c++)e(t[c],c,o,t);else{var u={},h=Object.keys(t).sort(s);for(c=0;c<h.length;c++){var f=h[c];e(t[f],f,o,t),u[f]=t[f]}if(void 0===a)return u;r.push([a,i,t]),a[i]=u}o.pop()}}(e,"",[],void 0)||e;for(o=0===n.length?JSON.stringify(c,t,i):JSON.stringify(c,a(t),i);0!==r.length;){var l=r.pop();4===l.length?Object.defineProperty(l[0],l[1],l[3]):l[0][l[1]]=l[2]}return o}function a(e){return e=void 0!==e?e:function(e,t){return t},function(t,r){if(n.length>0)for(var i=0;i<n.length;i++){var s=n[i];if(s[1]===t&&s[0]===r){r="[Circular]",n.splice(i,1);break}}return e.call(this,t,r)}}},function(e,t,r){var n=r(38),i={};for(var s in n)n.hasOwnProperty(s)&&(i[n[s]]=s);var o=e.exports={rgb:{channels:3,labels:"rgb"},hsl:{channels:3,labels:"hsl"},hsv:{channels:3,labels:"hsv"},hwb:{channels:3,labels:"hwb"},cmyk:{channels:4,labels:"cmyk"},xyz:{channels:3,labels:"xyz"},lab:{channels:3,labels:"lab"},lch:{channels:3,labels:"lch"},hex:{channels:1,labels:["hex"]},keyword:{channels:1,labels:["keyword"]},ansi16:{channels:1,labels:["ansi16"]},ansi256:{channels:1,labels:["ansi256"]},hcg:{channels:3,labels:["h","c","g"]},apple:{channels:3,labels:["r16","g16","b16"]},gray:{channels:1,labels:["gray"]}};for(var a in o)if(o.hasOwnProperty(a)){if(!("channels"in o[a]))throw new Error("missing channels property: "+a);if(!("labels"in o[a]))throw new Error("missing channel labels property: "+a);if(o[a].labels.length!==o[a].channels)throw new Error("channel and label counts mismatch: "+a);var c=o[a].channels,l=o[a].labels;delete o[a].channels,delete o[a].labels,Object.defineProperty(o[a],"channels",{value:c}),Object.defineProperty(o[a],"labels",{value:l})}o.rgb.hsl=function(e){var t,r,n=e[0]/255,i=e[1]/255,s=e[2]/255,o=Math.min(n,i,s),a=Math.max(n,i,s),c=a-o;return a===o?t=0:n===a?t=(i-s)/c:i===a?t=2+(s-n)/c:s===a&&(t=4+(n-i)/c),(t=Math.min(60*t,360))<0&&(t+=360),r=(o+a)/2,[t,100*(a===o?0:r<=.5?c/(a+o):c/(2-a-o)),100*r]},o.rgb.hsv=function(e){var t,r,n,i,s,o=e[0]/255,a=e[1]/255,c=e[2]/255,l=Math.max(o,a,c),u=l-Math.min(o,a,c),h=function(e){return(l-e)/6/u+.5};return 0===u?i=s=0:(s=u/l,t=h(o),r=h(a),n=h(c),o===l?i=n-r:a===l?i=1/3+t-n:c===l&&(i=2/3+r-t),i<0?i+=1:i>1&&(i-=1)),[360*i,100*s,100*l]},o.rgb.hwb=function(e){var t=e[0],r=e[1],n=e[2];return[o.rgb.hsl(e)[0],100*(1/255*Math.min(t,Math.min(r,n))),100*(n=1-1/255*Math.max(t,Math.max(r,n)))]},o.rgb.cmyk=function(e){var t,r=e[0]/255,n=e[1]/255,i=e[2]/255;return[100*((1-r-(t=Math.min(1-r,1-n,1-i)))/(1-t)||0),100*((1-n-t)/(1-t)||0),100*((1-i-t)/(1-t)||0),100*t]},o.rgb.keyword=function(e){var t=i[e];if(t)return t;var r,s,o,a=1/0;for(var c in n)if(n.hasOwnProperty(c)){var l=n[c],u=(s=e,o=l,Math.pow(s[0]-o[0],2)+Math.pow(s[1]-o[1],2)+Math.pow(s[2]-o[2],2));u<a&&(a=u,r=c)}return r},o.keyword.rgb=function(e){return n[e]},o.rgb.xyz=function(e){var t=e[0]/255,r=e[1]/255,n=e[2]/255;return[100*(.4124*(t=t>.04045?Math.pow((t+.055)/1.055,2.4):t/12.92)+.3576*(r=r>.04045?Math.pow((r+.055)/1.055,2.4):r/12.92)+.1805*(n=n>.04045?Math.pow((n+.055)/1.055,2.4):n/12.92)),100*(.2126*t+.7152*r+.0722*n),100*(.0193*t+.1192*r+.9505*n)]},o.rgb.lab=function(e){var t=o.rgb.xyz(e),r=t[0],n=t[1],i=t[2];return n/=100,i/=108.883,r=(r/=95.047)>.008856?Math.pow(r,1/3):7.787*r+16/116,[116*(n=n>.008856?Math.pow(n,1/3):7.787*n+16/116)-16,500*(r-n),200*(n-(i=i>.008856?Math.pow(i,1/3):7.787*i+16/116))]},o.hsl.rgb=function(e){var t,r,n,i,s,o=e[0]/360,a=e[1]/100,c=e[2]/100;if(0===a)return[s=255*c,s,s];t=2*c-(r=c<.5?c*(1+a):c+a-c*a),i=[0,0,0];for(var l=0;l<3;l++)(n=o+1/3*-(l-1))<0&&n++,n>1&&n--,s=6*n<1?t+6*(r-t)*n:2*n<1?r:3*n<2?t+(r-t)*(2/3-n)*6:t,i[l]=255*s;return i},o.hsl.hsv=function(e){var t=e[0],r=e[1]/100,n=e[2]/100,i=r,s=Math.max(n,.01);return r*=(n*=2)<=1?n:2-n,i*=s<=1?s:2-s,[t,100*(0===n?2*i/(s+i):2*r/(n+r)),100*((n+r)/2)]},o.hsv.rgb=function(e){var t=e[0]/60,r=e[1]/100,n=e[2]/100,i=Math.floor(t)%6,s=t-Math.floor(t),o=255*n*(1-r),a=255*n*(1-r*s),c=255*n*(1-r*(1-s));switch(n*=255,i){case 0:return[n,c,o];case 1:return[a,n,o];case 2:return[o,n,c];case 3:return[o,a,n];case 4:return[c,o,n];case 5:return[n,o,a]}},o.hsv.hsl=function(e){var t,r,n,i=e[0],s=e[1]/100,o=e[2]/100,a=Math.max(o,.01);return n=(2-s)*o,r=s*a,[i,100*(r=(r/=(t=(2-s)*a)<=1?t:2-t)||0),100*(n/=2)]},o.hwb.rgb=function(e){var t,r,n,i,s,o,a,c=e[0]/360,l=e[1]/100,u=e[2]/100,h=l+u;switch(h>1&&(l/=h,u/=h),n=6*c-(t=Math.floor(6*c)),0!=(1&t)&&(n=1-n),i=l+n*((r=1-u)-l),t){default:case 6:case 0:s=r,o=i,a=l;break;case 1:s=i,o=r,a=l;break;case 2:s=l,o=r,a=i;break;case 3:s=l,o=i,a=r;break;case 4:s=i,o=l,a=r;break;case 5:s=r,o=l,a=i}return[255*s,255*o,255*a]},o.cmyk.rgb=function(e){var t=e[0]/100,r=e[1]/100,n=e[2]/100,i=e[3]/100;return[255*(1-Math.min(1,t*(1-i)+i)),255*(1-Math.min(1,r*(1-i)+i)),255*(1-Math.min(1,n*(1-i)+i))]},o.xyz.rgb=function(e){var t,r,n,i=e[0]/100,s=e[1]/100,o=e[2]/100;return r=-.9689*i+1.8758*s+.0415*o,n=.0557*i+-.204*s+1.057*o,t=(t=3.2406*i+-1.5372*s+-.4986*o)>.0031308?1.055*Math.pow(t,1/2.4)-.055:12.92*t,r=r>.0031308?1.055*Math.pow(r,1/2.4)-.055:12.92*r,n=n>.0031308?1.055*Math.pow(n,1/2.4)-.055:12.92*n,[255*(t=Math.min(Math.max(0,t),1)),255*(r=Math.min(Math.max(0,r),1)),255*(n=Math.min(Math.max(0,n),1))]},o.xyz.lab=function(e){var t=e[0],r=e[1],n=e[2];return r/=100,n/=108.883,t=(t/=95.047)>.008856?Math.pow(t,1/3):7.787*t+16/116,[116*(r=r>.008856?Math.pow(r,1/3):7.787*r+16/116)-16,500*(t-r),200*(r-(n=n>.008856?Math.pow(n,1/3):7.787*n+16/116))]},o.lab.xyz=function(e){var t,r,n,i=e[0];t=e[1]/500+(r=(i+16)/116),n=r-e[2]/200;var s=Math.pow(r,3),o=Math.pow(t,3),a=Math.pow(n,3);return r=s>.008856?s:(r-16/116)/7.787,t=o>.008856?o:(t-16/116)/7.787,n=a>.008856?a:(n-16/116)/7.787,[t*=95.047,r*=100,n*=108.883]},o.lab.lch=function(e){var t,r=e[0],n=e[1],i=e[2];return(t=360*Math.atan2(i,n)/2/Math.PI)<0&&(t+=360),[r,Math.sqrt(n*n+i*i),t]},o.lch.lab=function(e){var t,r=e[0],n=e[1];return t=e[2]/360*2*Math.PI,[r,n*Math.cos(t),n*Math.sin(t)]},o.rgb.ansi16=function(e){var t=e[0],r=e[1],n=e[2],i=1 in arguments?arguments[1]:o.rgb.hsv(e)[2];if(0===(i=Math.round(i/50)))return 30;var s=30+(Math.round(n/255)<<2|Math.round(r/255)<<1|Math.round(t/255));return 2===i&&(s+=60),s},o.hsv.ansi16=function(e){return o.rgb.ansi16(o.hsv.rgb(e),e[2])},o.rgb.ansi256=function(e){var t=e[0],r=e[1],n=e[2];return t===r&&r===n?t<8?16:t>248?231:Math.round((t-8)/247*24)+232:16+36*Math.round(t/255*5)+6*Math.round(r/255*5)+Math.round(n/255*5)},o.ansi16.rgb=function(e){var t=e%10;if(0===t||7===t)return e>50&&(t+=3.5),[t=t/10.5*255,t,t];var r=.5*(1+~~(e>50));return[(1&t)*r*255,(t>>1&1)*r*255,(t>>2&1)*r*255]},o.ansi256.rgb=function(e){if(e>=232){var t=10*(e-232)+8;return[t,t,t]}var r;return e-=16,[Math.floor(e/36)/5*255,Math.floor((r=e%36)/6)/5*255,r%6/5*255]},o.rgb.hex=function(e){var t=(((255&Math.round(e[0]))<<16)+((255&Math.round(e[1]))<<8)+(255&Math.round(e[2]))).toString(16).toUpperCase();return"000000".substring(t.length)+t},o.hex.rgb=function(e){var t=e.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i);if(!t)return[0,0,0];var r=t[0];3===t[0].length&&(r=r.split("").map((function(e){return e+e})).join(""));var n=parseInt(r,16);return[n>>16&255,n>>8&255,255&n]},o.rgb.hcg=function(e){var t,r=e[0]/255,n=e[1]/255,i=e[2]/255,s=Math.max(Math.max(r,n),i),o=Math.min(Math.min(r,n),i),a=s-o;return t=a<=0?0:s===r?(n-i)/a%6:s===n?2+(i-r)/a:4+(r-n)/a+4,t/=6,[360*(t%=1),100*a,100*(a<1?o/(1-a):0)]},o.hsl.hcg=function(e){var t=e[1]/100,r=e[2]/100,n=1,i=0;return(n=r<.5?2*t*r:2*t*(1-r))<1&&(i=(r-.5*n)/(1-n)),[e[0],100*n,100*i]},o.hsv.hcg=function(e){var t=e[1]/100,r=e[2]/100,n=t*r,i=0;return n<1&&(i=(r-n)/(1-n)),[e[0],100*n,100*i]},o.hcg.rgb=function(e){var t=e[0]/360,r=e[1]/100,n=e[2]/100;if(0===r)return[255*n,255*n,255*n];var i,s=[0,0,0],o=t%1*6,a=o%1,c=1-a;switch(Math.floor(o)){case 0:s[0]=1,s[1]=a,s[2]=0;break;case 1:s[0]=c,s[1]=1,s[2]=0;break;case 2:s[0]=0,s[1]=1,s[2]=a;break;case 3:s[0]=0,s[1]=c,s[2]=1;break;case 4:s[0]=a,s[1]=0,s[2]=1;break;default:s[0]=1,s[1]=0,s[2]=c}return i=(1-r)*n,[255*(r*s[0]+i),255*(r*s[1]+i),255*(r*s[2]+i)]},o.hcg.hsv=function(e){var t=e[1]/100,r=t+e[2]/100*(1-t),n=0;return r>0&&(n=t/r),[e[0],100*n,100*r]},o.hcg.hsl=function(e){var t=e[1]/100,r=e[2]/100*(1-t)+.5*t,n=0;return r>0&&r<.5?n=t/(2*r):r>=.5&&r<1&&(n=t/(2*(1-r))),[e[0],100*n,100*r]},o.hcg.hwb=function(e){var t=e[1]/100,r=t+e[2]/100*(1-t);return[e[0],100*(r-t),100*(1-r)]},o.hwb.hcg=function(e){var t=e[1]/100,r=1-e[2]/100,n=r-t,i=0;return n<1&&(i=(r-n)/(1-n)),[e[0],100*n,100*i]},o.apple.rgb=function(e){return[e[0]/65535*255,e[1]/65535*255,e[2]/65535*255]},o.rgb.apple=function(e){return[e[0]/255*65535,e[1]/255*65535,e[2]/255*65535]},o.gray.rgb=function(e){return[e[0]/100*255,e[0]/100*255,e[0]/100*255]},o.gray.hsl=o.gray.hsv=function(e){return[0,0,e[0]]},o.gray.hwb=function(e){return[0,100,e[0]]},o.gray.cmyk=function(e){return[0,0,0,e[0]]},o.gray.lab=function(e){return[e[0],0,0]},o.gray.hex=function(e){var t=255&Math.round(e[0]/100*255),r=((t<<16)+(t<<8)+t).toString(16).toUpperCase();return"000000".substring(r.length)+r},o.rgb.gray=function(e){return[(e[0]+e[1]+e[2])/3/255*100]}},function(e,t,r){"use strict";const{version:n}=r(47);e.exports={version:n,LOG_VERSION:1}},function(e,t,r){"use strict";const n=r(7),i=r(8),s=r(21),o=r(29),a=r(30),c=r(0),{assertDefaultLevelFound:l,mappings:u,genLsCache:h}=r(12),{createArgsNormalizer:f,asChindings:p,final:d,stringify:y,buildSafeSonicBoom:m}=r(3),{version:g,LOG_VERSION:v}=r(15),{chindingsSym:b,redactFmtSym:_,serializersSym:w,timeSym:S,streamSym:k,stringifySym:O,stringifiersSym:x,setLevelSym:j,endSym:E,formatOptsSym:M,messageKeyStringSym:T,useLevelLabelsSym:L,changeLevelNameSym:R,useOnlyCustomLevelsSym:N}=c,{epochTime:C,nullTime:P}=o,{pid:A}=process,$=n.hostname(),I=i.err,D={level:"info",useLevelLabels:!1,messageKey:"msg",enabled:!0,prettyPrint:!1,base:{pid:A,hostname:$},serializers:Object.assign(Object.create(null),{err:I}),timestamp:C,name:void 0,redact:null,customLevels:null,changeLevelName:"level",useOnlyCustomLevels:!1},F=f(D),z=Object.assign(Object.create(null),i);function B(...e){const{opts:t,stream:r}=F(...e),{redact:n,crlf:i,serializers:o,timestamp:c,messageKey:f,base:d,name:m,level:g,customLevels:A,useLevelLabels:$,changeLevelName:I,useOnlyCustomLevels:z}=t,B=n?s(n,y):{},H=n?{stringify:B[_]}:{stringify:y},q=`,"${f}":`,G=',"v":'+v+"}"+(i?"\r\n":"\n"),J=p.bind(null,{[b]:"",[w]:o,[x]:B,[O]:y}),U=null===d?"":J(void 0===m?d:Object.assign({},d,{name:m})),V=c instanceof Function?c:c?C:P;if(z&&!A)throw Error("customLevels is required if useOnlyCustomLevels is set true");l(g,A,z);const K={levels:u(A,z),[L]:$,[R]:I,[N]:z,[k]:r,[S]:V,[O]:y,[x]:B,[E]:G,[M]:H,[T]:q,[w]:o,[b]:U};return Object.setPrototypeOf(K,a),(A||$||I!==D.changeLevelName)&&h(K),K[j](g),K}B.extreme=(e=process.stdout.fd)=>m(e,4096,!1),B.destination=(e=process.stdout.fd)=>m(e,0,!0),B.final=d,B.levels=u(),B.stdSerializers=z,B.stdTimeFunctions=Object.assign({},o),B.symbols=c,B.version=g,B.LOG_VERSION=v,e.exports=B},function(e,t,r){const{todayName:n}=r(48),{Time:i}=r(5);e.exports={todayName:n,getDay:i.serverTimeGetDay}},function(e,t,r){"use strict";e.exports=function e(t){if(!(t instanceof Error))return t;t[n]=void 0;const r=Object.create(s);r.type=t.constructor.name,r.message=t.message,r.stack=t.stack;for(const i in t)if(void 0===r[i]){const s=t[i];s instanceof Error?s.hasOwnProperty(n)||(r[i]=e(s)):r[i]=s}return delete t[n],r.raw=t,r};const n=Symbol("circular-ref-tag"),i=Symbol("pino-raw-err-ref"),s=Object.create({},{type:{enumerable:!0,writable:!0,value:void 0},message:{enumerable:!0,writable:!0,value:void 0},stack:{enumerable:!0,writable:!0,value:void 0},raw:{enumerable:!1,get:function(){return this[i]},set:function(e){this[i]=e}}});Object.defineProperty(s,i,{writable:!0,value:{}})},function(e,t,r){"use strict";e.exports={mapHttpRequest:function(e){return{req:s(e)}},reqSerializer:s};var n=Symbol("pino-raw-req-ref"),i=Object.create({},{id:{enumerable:!0,writable:!0,value:""},method:{enumerable:!0,writable:!0,value:""},url:{enumerable:!0,writable:!0,value:""},headers:{enumerable:!0,writable:!0,value:{}},remoteAddress:{enumerable:!0,writable:!0,value:""},remotePort:{enumerable:!0,writable:!0,value:""},raw:{enumerable:!1,get:function(){return this[n]},set:function(e){this[n]=e}}});function s(e){var t=e.info||e.connection;const r=Object.create(i);return r.id="function"==typeof e.id?e.id():e.id||(e.info?e.info.id:void 0),r.method=e.method,e.originalUrl?r.url=e.originalUrl:r.url=e.url?e.url.path||e.url:void 0,r.headers=e.headers,r.remoteAddress=t&&t.remoteAddress,r.remotePort=t&&t.remotePort,r.raw=e.raw||e,r}Object.defineProperty(i,n,{writable:!0,value:{}})},function(e,t,r){"use strict";e.exports={mapHttpResponse:function(e){return{res:s(e)}},resSerializer:s};var n=Symbol("pino-raw-res-ref"),i=Object.create({},{statusCode:{enumerable:!0,writable:!0,value:0},headers:{enumerable:!0,writable:!0,value:""},raw:{enumerable:!1,get:function(){return this[n]},set:function(e){this[n]=e}}});function s(e){const t=Object.create(i);return t.statusCode=e.statusCode,t.headers=e.getHeaders?e.getHeaders():e._headers,t.raw=e,t}Object.defineProperty(i,n,{writable:!0,value:{}})},function(e,t,r){"use strict";const n=r(22),{redactFmtSym:i}=r(0),{rx:s,validator:o}=n,a=o({ERR_PATHS_MUST_BE_STRINGS:()=>"pino – redacted paths must be strings",ERR_INVALID_PATH:e=>`pino – redact paths array contains an invalid path (${e})`}),c="[Redacted]",l=!1;e.exports=function(e,t){const{paths:r,censor:o}=function(e){if(Array.isArray(e))return a(e={paths:e,censor:c}),e;var{paths:t,censor:r=c,remove:n}=e;if(!1===Array.isArray(t))throw Error("pino – redact must contain an array of strings");!0===n&&(r=void 0);return a({paths:t,censor:r}),{paths:t,censor:r}}(e),u=r.reduce((e,t)=>{s.lastIndex=0,s.exec(t);const r=s.exec(t);if(null===r)return e[t]=null,e;const{index:n}=r,i="["===t[n-1]?"[":"",o=t.substr(0,n-1).replace(/^\["(.+)"\]$/,"$1");return e[o]=e[o]||[],e[o].push(`${i}${t.substr(n,t.length-1)}`),e},{}),h={[i]:n({paths:r,censor:o,serialize:t,strict:l})},f=t(o),p=()=>f;return Object.keys(u).reduce((e,r)=>(null===u[r]?e[r]=p:e[r]=n({paths:u[r],censor:o,serialize:t,strict:l}),e),h)}},function(e,t,r){"use strict";const n=r(23),i=r(25),s=r(26),o=r(27),{groupRedact:a,nestedRedact:c}=r(9),l=r(28),u=r(1),h=n(),f=e=>e;f.restore=f;const p="[REDACTED]";function d(e={}){const t=Array.from(new Set(e.paths||[])),r="serialize"in e?!1===e.serialize?e.serialize:"function"==typeof e.serialize?e.serialize:JSON.stringify:JSON.stringify,n=e.remove;if(!0===n&&r!==JSON.stringify)throw Error("fast-redact – remove option may only be set when serializer is JSON.stringify");const u=!0===n?void 0:"censor"in e?e.censor:p,d="function"==typeof u;if(0===t.length)return r||f;h({paths:t,serialize:r,censor:u});const{wildcards:y,wcLen:m,secret:g}=i({paths:t,censor:u}),v=o({secret:g,wcLen:m}),b=!("strict"in e)||e.strict;return s({secret:g,wcLen:m,serialize:r,strict:b,isCensorFct:d},l({secret:g,censor:u,compileRestore:v,serialize:r,groupRedact:a,nestedRedact:c,wildcards:y,wcLen:m}))}d.rx=u,d.validator=n,e.exports=d},function(e,t,r){"use strict";const{createContext:n,runInContext:i}=r(24);e.exports=function(e={}){const{ERR_PATHS_MUST_BE_STRINGS:t=(()=>"fast-redact - Paths must be strings"),ERR_INVALID_PATH:r=(e=>`fast-redact – Invalid path (${e})`)}=e;return function({paths:e}){e.forEach(e=>{if("string"!=typeof e)throw Error(t());try{if(/〇/.test(e))throw Error();const t=new Proxy({},{get:()=>t,set:()=>{throw Error()}}),r=("["===e[0]?"":".")+e.replace(/^\*/,"〇").replace(/\.\*/g,".〇").replace(/\[\*\]/g,"[〇]");if(/\n|\r|;/.test(r))throw Error();if(/\/\*/.test(r))throw Error();i(`\n          (function () {\n            'use strict'\n            o${r}\n            if ([o${r}].length !== 1) throw Error()\n          })()\n        `,n({o:t,"〇":null}),{codeGeneration:{strings:!1,wasm:!1}})}catch(t){throw Error(r(e))}})}}},function(e,t){e.exports=require("vm")},function(e,t,r){"use strict";const n=r(1);e.exports=function({paths:e}){const t=[];var r=0;const i=e.reduce((function(e,i,s){var o=i.match(n).map(e=>e.replace(/'|"|`/g,""));const a="["===i[0],c=(o=o.map(e=>"["===e[0]?e.substr(1,e.length-2):e)).indexOf("*");if(c>-1){const e=o.slice(0,c),n=e.join("."),i=o.slice(c+1,o.length);if(i.indexOf("*")>-1)throw Error("fast-redact – Only one wildcard per path is supported");const s=i.length>0;r++,t.push({before:e,beforeStr:n,after:i,nested:s})}else e[i]={path:o,val:void 0,precensored:!1,circle:"",escPath:JSON.stringify(i),leadingBracket:a};return e}),{});return{wildcards:t,wcLen:r,secret:i}}},function(e,t,r){"use strict";const n=r(1);e.exports=function({secret:e,serialize:t,wcLen:r,strict:i,isCensorFct:s},o){const a=Function("o",`\n    if (typeof o !== 'object' || o == null) {\n      ${function(e,t){return!0===e?"throw Error('fast-redact: primitives cannot be redacted')":!1===t?"return o":"return this.serialize(o)"}(i,t)}\n    }\n    const { censor, secret } = this\n    ${function(e,t){return Object.keys(e).map(r=>{const{escPath:i,leadingBracket:s}=e[r],o=s?1:0,a=s?"":".",c=[];for(var l;null!==(l=n.exec(r));){const[,e]=l,{index:t,input:r}=l;t>o&&c.push(r.substring(0,t-(e?0:1)))}var u=c.map(e=>`o${a}${e}`).join(" && ");0===u.length?u+=`o${a}${r} != null`:u+=` && o${a}${r} != null`;const h=`\n      switch (true) {\n        ${c.reverse().map(e=>`\n          case o${a}${e} === censor:\n            secret[${i}].circle = ${JSON.stringify(e)}\n            break\n        `).join("\n")}\n      }\n    `;return`\n      if (${u}) {\n        const val = o${a}${r}\n        if (val === censor) {\n          secret[${i}].precensored = true\n        } else {\n          secret[${i}].val = val\n          o${a}${r} = ${t?"censor(val)":"censor"}\n          ${h}\n        }\n      }\n    `}).join("\n")}(e,s)}\n    this.compileRestore()\n    ${function(e,t){return!0===e?`\n    {\n      const { wildcards, wcLen, groupRedact, nestedRedact } = this\n      for (var i = 0; i < wcLen; i++) {\n        const { before, beforeStr, after, nested } = wildcards[i]\n        if (nested === true) {\n          secret[beforeStr] = secret[beforeStr] || []\n          nestedRedact(secret[beforeStr], o, before, after, censor, ${t})\n        } else secret[beforeStr] = groupRedact(o, before, censor, ${t})\n      }\n    }\n  `:""}(r>0,s)}\n    ${function(e){return!1===e?"return o":"\n    var s = this.serialize(o)\n    this.restore(o)\n    return s\n  "}(t)}\n  `).bind(o);!1===t&&(a.restore=e=>o.restore(e));return a}},function(e,t,r){"use strict";const{groupRestore:n,nestedRestore:i}=r(9);e.exports=function({secret:e,wcLen:t}){return function(){if(this.restore)return;const r=Object.keys(e).filter(t=>!1===e[t].precensored),s=function(e,t){return t.map(t=>{const{circle:r,escPath:n,leadingBracket:i}=e[t];return`\n      if (secret[${n}].val !== undefined) {\n        try { ${r?`o.${r} = secret[${n}].val`:`o${i?"":"."}${t} = secret[${n}].val`} } catch (e) {}\n        ${`secret[${n}].val = undefined`}\n      }\n    `}).join("")}(e,r),o=t>0,a=o?{secret:e,groupRestore:n,nestedRestore:i}:{secret:e};this.restore=Function("o",function(e,t,r){const n=!0===r?`\n    const keys = Object.keys(secret)\n    const len = keys.length\n    for (var i = ${t.length}; i < len; i++) {\n      const k = keys[i]\n      const o = secret[k]\n      if (o.flat === true) this.groupRestore(o)\n      else this.nestedRestore(o)\n      secret[k] = null\n    }\n  `:"";return`\n    const secret = this.secret\n    ${e}\n    ${n}\n    return o\n  `}(s,r,o)).bind(a)}}},function(e,t,r){"use strict";e.exports=function(e){const{secret:t,censor:r,isCensorFct:n,compileRestore:i,serialize:s,groupRedact:o,nestedRedact:a,wildcards:c,wcLen:l}=e,u=[{secret:t,censor:r,isCensorFct:n,compileRestore:i}];u.push({secret:t}),!1!==s&&u.push({serialize:s});l>0&&u.push({groupRedact:o,nestedRedact:a,wildcards:c,wcLen:l});return Object.assign(...u)}},function(e,t,r){"use strict";e.exports={nullTime:()=>"",epochTime:()=>`,"time":${Date.now()}`,unixTime:()=>`,"time":${Math.round(Date.now()/1e3)}`}},function(e,t,r){"use strict";const{EventEmitter:n}=r(10),i=r(11),s=r(2),{lsCacheSym:o,levelValSym:a,setLevelSym:c,getLevelSym:l,chindingsSym:u,asJsonSym:h,writeSym:f,timeSym:p,streamSym:d,serializersSym:y,useOnlyCustomLevelsSym:m,needsMetadataGsym:g}=r(0),{getLevel:v,setLevel:b,isLevelEnabled:_,mappings:w,initialLsCache:S,genLsCache:k,assertNoLevelCollisions:O}=r(12),{asChindings:x,asJson:j}=r(3),{version:E,LOG_VERSION:M}=r(15),T={constructor:class{},child:function(e){const{level:t}=this,r=this[y],n=x(this,e),i=Object.create(this);if(!0===e.hasOwnProperty("serializers")){for(var s in i[y]=Object.create(null),r)i[y][s]=r[s];for(var o in e.serializers)i[y][o]=e.serializers[o]}else i[y]=r;!0===e.hasOwnProperty("customLevels")&&(O(this.levels,e.customLevels),i.levels=w(e.customLevels,i[m]),k(i));i[u]=n;const a=e.level||t;return i[c](a),i},flush:function(){const e=this[d];"flush"in e&&e.flush()},isLevelEnabled:_,version:E,get level(){return this[l]()},set level(e){return this[c](e)},get levelVal(){return this[a]},set levelVal(e){throw Error("levelVal is read-only")},[o]:S,[f]:function(e,t,r){const n=this[p](),o=this[h](e,t,r,n),a=this[d];!0===a[g]&&(a.lastLevel=r,a.lastMsg=t,a.lastObj=e,a.lastTime=n.slice(8),a.lastLogger=this);a instanceof i?a.write(o):a.write(s(o))},[h]:j,[l]:v,[c]:b,LOG_VERSION:M};Object.setPrototypeOf(T,n.prototype),e.exports=T},function(e,t){e.exports=require("fs")},function(e,t,r){"use strict";function n(e){try{return JSON.stringify(e)}catch(e){return'"[Circular]"'}}e.exports=function(e,t,r){var i=r&&r.stringify||n,s=1;null===e&&(e=t[0],s=0);if("object"==typeof e&&null!==e){var o=t.length+s;if(1===o)return e;var a=new Array(o);a[0]=i(e);for(var c=1;c<o;c++)a[c]=i(t[c]);return a.join(" ")}var l=t.length;if(0===l)return e;for(var u="",h="",f=1-s,p=0,d=e&&e.length||0,y=0;y<d;){if(37===e.charCodeAt(y)&&y+1<d){switch(e.charCodeAt(y+1)){case 100:if(f>=l)break;if(p<y&&(h+=e.slice(p,y)),null==t[f])break;h+=Number(t[f]),p=y+=2;break;case 79:case 111:case 106:if(f>=l)break;if(p<y&&(h+=e.slice(p,y)),void 0===t[f])break;var m=typeof t[f];if("string"===m){h+="'"+t[f]+"'",p=y+2,y++;break}if("function"===m){h+=t[f].name||"<anonymous>",p=y+2,y++;break}h+=i(t[f]),p=y+2,y++;break;case 115:if(f>=l)break;p<y&&(h+=e.slice(p,y)),h+=String(t[f]),p=y+2,y++;break;case 37:p<y&&(h+=e.slice(p,y)),h+="%",p=y+2,y++}++f}++y}0===p?h=e:p<d&&(h+=e.slice(p));for(;f<l;)u=t[f++],h+=null===u||"object"!=typeof u?" "+String(u):" "+i(u);return h}},function(e,t,r){"use strict";const n=r(34),i=r(35),s=r(40).stdout,o=r(42),a="win32"===process.platform&&!(process.env.TERM||"").toLowerCase().startsWith("xterm"),c=["ansi","ansi","ansi256","ansi16m"],l=new Set(["gray"]),u=Object.create(null);function h(e,t){t=t||{};const r=s?s.level:0;e.level=void 0===t.level?r:t.level,e.enabled="enabled"in t?t.enabled:e.level>0}function f(e){if(!this||!(this instanceof f)||this.template){const t={};return h(t,e),t.template=function(){const e=[].slice.call(arguments);return m.apply(null,[t.template].concat(e))},Object.setPrototypeOf(t,f.prototype),Object.setPrototypeOf(t.template,t),t.template.constructor=f,t.template}h(this,e)}a&&(i.blue.open="[94m");for(const e of Object.keys(i))i[e].closeRe=new RegExp(n(i[e].close),"g"),u[e]={get(){const t=i[e];return d.call(this,this._styles?this._styles.concat(t):[t],this._empty,e)}};u.visible={get(){return d.call(this,this._styles||[],!0,"visible")}},i.color.closeRe=new RegExp(n(i.color.close),"g");for(const e of Object.keys(i.color.ansi))l.has(e)||(u[e]={get(){const t=this.level;return function(){const r=i.color[c[t]][e].apply(null,arguments),n={open:r,close:i.color.close,closeRe:i.color.closeRe};return d.call(this,this._styles?this._styles.concat(n):[n],this._empty,e)}}});i.bgColor.closeRe=new RegExp(n(i.bgColor.close),"g");for(const e of Object.keys(i.bgColor.ansi)){if(l.has(e))continue;u["bg"+e[0].toUpperCase()+e.slice(1)]={get(){const t=this.level;return function(){const r=i.bgColor[c[t]][e].apply(null,arguments),n={open:r,close:i.bgColor.close,closeRe:i.bgColor.closeRe};return d.call(this,this._styles?this._styles.concat(n):[n],this._empty,e)}}}}const p=Object.defineProperties(()=>{},u);function d(e,t,r){const n=function(){return y.apply(n,arguments)};n._styles=e,n._empty=t;const i=this;return Object.defineProperty(n,"level",{enumerable:!0,get:()=>i.level,set(e){i.level=e}}),Object.defineProperty(n,"enabled",{enumerable:!0,get:()=>i.enabled,set(e){i.enabled=e}}),n.hasGrey=this.hasGrey||"gray"===r||"grey"===r,n.__proto__=p,n}function y(){const e=arguments,t=e.length;let r=String(arguments[0]);if(0===t)return"";if(t>1)for(let n=1;n<t;n++)r+=" "+e[n];if(!this.enabled||this.level<=0||!r)return this._empty?"":r;const n=i.dim.open;a&&this.hasGrey&&(i.dim.open="");for(const e of this._styles.slice().reverse())r=e.open+r.replace(e.closeRe,e.open)+e.close,r=r.replace(/\r?\n/g,`${e.close}$&${e.open}`);return i.dim.open=n,r}function m(e,t){if(!Array.isArray(t))return[].slice.call(arguments,1).join(" ");const r=[].slice.call(arguments,2),n=[t.raw[0]];for(let e=1;e<t.length;e++)n.push(String(r[e-1]).replace(/[{}\\]/g,"\\$&")),n.push(String(t.raw[e]));return o(e,n.join(""))}Object.defineProperties(f.prototype,u),e.exports=f(),e.exports.supportsColor=s,e.exports.default=e.exports},function(e,t,r){"use strict";var n=/[|\\{}()[\]^$+*?.]/g;e.exports=function(e){if("string"!=typeof e)throw new TypeError("Expected a string");return e.replace(n,"\\$&")}},function(e,t,r){"use strict";(function(e){const t=r(37),n=(e,r)=>(function(){const n=e.apply(t,arguments);return`[${n+r}m`}),i=(e,r)=>(function(){const n=e.apply(t,arguments);return`[${38+r};5;${n}m`}),s=(e,r)=>(function(){const n=e.apply(t,arguments);return`[${38+r};2;${n[0]};${n[1]};${n[2]}m`});Object.defineProperty(e,"exports",{enumerable:!0,get:function(){const e=new Map,r={modifier:{reset:[0,0],bold:[1,22],dim:[2,22],italic:[3,23],underline:[4,24],inverse:[7,27],hidden:[8,28],strikethrough:[9,29]},color:{black:[30,39],red:[31,39],green:[32,39],yellow:[33,39],blue:[34,39],magenta:[35,39],cyan:[36,39],white:[37,39],gray:[90,39],redBright:[91,39],greenBright:[92,39],yellowBright:[93,39],blueBright:[94,39],magentaBright:[95,39],cyanBright:[96,39],whiteBright:[97,39]},bgColor:{bgBlack:[40,49],bgRed:[41,49],bgGreen:[42,49],bgYellow:[43,49],bgBlue:[44,49],bgMagenta:[45,49],bgCyan:[46,49],bgWhite:[47,49],bgBlackBright:[100,49],bgRedBright:[101,49],bgGreenBright:[102,49],bgYellowBright:[103,49],bgBlueBright:[104,49],bgMagentaBright:[105,49],bgCyanBright:[106,49],bgWhiteBright:[107,49]}};r.color.grey=r.color.gray;for(const t of Object.keys(r)){const n=r[t];for(const t of Object.keys(n)){const i=n[t];r[t]={open:`[${i[0]}m`,close:`[${i[1]}m`},n[t]=r[t],e.set(i[0],i[1])}Object.defineProperty(r,t,{value:n,enumerable:!1}),Object.defineProperty(r,"codes",{value:e,enumerable:!1})}const o=e=>e,a=(e,t,r)=>[e,t,r];r.color.close="[39m",r.bgColor.close="[49m",r.color.ansi={ansi:n(o,0)},r.color.ansi256={ansi256:i(o,0)},r.color.ansi16m={rgb:s(a,0)},r.bgColor.ansi={ansi:n(o,10)},r.bgColor.ansi256={ansi256:i(o,10)},r.bgColor.ansi16m={rgb:s(a,10)};for(let e of Object.keys(t)){if("object"!=typeof t[e])continue;const o=t[e];"ansi16"===e&&(e="ansi"),"ansi16"in o&&(r.color.ansi[e]=n(o.ansi16,0),r.bgColor.ansi[e]=n(o.ansi16,10)),"ansi256"in o&&(r.color.ansi256[e]=i(o.ansi256,0),r.bgColor.ansi256[e]=i(o.ansi256,10)),"rgb"in o&&(r.color.ansi16m[e]=s(o.rgb,0),r.bgColor.ansi16m[e]=s(o.rgb,10))}return r}})}).call(this,r(36)(e))},function(e,t){e.exports=function(e){return e.webpackPolyfill||(e.deprecate=function(){},e.paths=[],e.children||(e.children=[]),Object.defineProperty(e,"loaded",{enumerable:!0,get:function(){return e.l}}),Object.defineProperty(e,"id",{enumerable:!0,get:function(){return e.i}}),e.webpackPolyfill=1),e}},function(e,t,r){var n=r(14),i=r(39),s={};Object.keys(n).forEach((function(e){s[e]={},Object.defineProperty(s[e],"channels",{value:n[e].channels}),Object.defineProperty(s[e],"labels",{value:n[e].labels});var t=i(e);Object.keys(t).forEach((function(r){var n=t[r];s[e][r]=function(e){var t=function(t){if(null==t)return t;arguments.length>1&&(t=Array.prototype.slice.call(arguments));var r=e(t);if("object"==typeof r)for(var n=r.length,i=0;i<n;i++)r[i]=Math.round(r[i]);return r};return"conversion"in e&&(t.conversion=e.conversion),t}(n),s[e][r].raw=function(e){var t=function(t){return null==t?t:(arguments.length>1&&(t=Array.prototype.slice.call(arguments)),e(t))};return"conversion"in e&&(t.conversion=e.conversion),t}(n)}))})),e.exports=s},function(e,t,r){"use strict";e.exports={aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],darkgray:[169,169,169],darkgreen:[0,100,0],darkgrey:[169,169,169],darkkhaki:[189,183,107],darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],darkslategray:[47,79,79],darkslategrey:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dimgrey:[105,105,105],dodgerblue:[30,144,255],firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],fuchsia:[255,0,255],gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],goldenrod:[218,165,32],gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],grey:[128,128,128],honeydew:[240,255,240],hotpink:[255,105,180],indianred:[205,92,92],indigo:[75,0,130],ivory:[255,255,240],khaki:[240,230,140],lavender:[230,230,250],lavenderblush:[255,240,245],lawngreen:[124,252,0],lemonchiffon:[255,250,205],lightblue:[173,216,230],lightcoral:[240,128,128],lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightsalmon:[255,160,122],lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],lightslategrey:[119,136,153],lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],mediumseagreen:[60,179,113],mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],mediumturquoise:[72,209,204],mediumvioletred:[199,21,133],midnightblue:[25,25,112],mintcream:[245,255,250],mistyrose:[255,228,225],moccasin:[255,228,181],navajowhite:[255,222,173],navy:[0,0,128],oldlace:[253,245,230],olive:[128,128,0],olivedrab:[107,142,35],orange:[255,165,0],orangered:[255,69,0],orchid:[218,112,214],palegoldenrod:[238,232,170],palegreen:[152,251,152],paleturquoise:[175,238,238],palevioletred:[219,112,147],papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],pink:[255,192,203],plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],rebeccapurple:[102,51,153],red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],saddlebrown:[139,69,19],salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],seashell:[255,245,238],sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],slateblue:[106,90,205],slategray:[112,128,144],slategrey:[112,128,144],snow:[255,250,250],springgreen:[0,255,127],steelblue:[70,130,180],tan:[210,180,140],teal:[0,128,128],thistle:[216,191,216],tomato:[255,99,71],turquoise:[64,224,208],violet:[238,130,238],wheat:[245,222,179],white:[255,255,255],whitesmoke:[245,245,245],yellow:[255,255,0],yellowgreen:[154,205,50]}},function(e,t,r){var n=r(14);function i(e){var t=function(){for(var e={},t=Object.keys(n),r=t.length,i=0;i<r;i++)e[t[i]]={distance:-1,parent:null};return e}(),r=[e];for(t[e].distance=0;r.length;)for(var i=r.pop(),s=Object.keys(n[i]),o=s.length,a=0;a<o;a++){var c=s[a],l=t[c];-1===l.distance&&(l.distance=t[i].distance+1,l.parent=i,r.unshift(c))}return t}function s(e,t){return function(r){return t(e(r))}}function o(e,t){for(var r=[t[e].parent,e],i=n[t[e].parent][e],o=t[e].parent;t[o].parent;)r.unshift(t[o].parent),i=s(n[t[o].parent][o],i),o=t[o].parent;return i.conversion=r,i}e.exports=function(e){for(var t=i(e),r={},n=Object.keys(t),s=n.length,a=0;a<s;a++){var c=n[a];null!==t[c].parent&&(r[c]=o(c,t))}return r}},function(e,t,r){"use strict";const n=r(7),i=r(41),s=process.env;let o;function a(e){return function(e){return 0!==e&&{level:e,hasBasic:!0,has256:e>=2,has16m:e>=3}}(function(e){if(!1===o)return 0;if(i("color=16m")||i("color=full")||i("color=truecolor"))return 3;if(i("color=256"))return 2;if(e&&!e.isTTY&&!0!==o)return 0;const t=o?1:0;if("win32"===process.platform){const e=n.release().split(".");return Number(process.versions.node.split(".")[0])>=8&&Number(e[0])>=10&&Number(e[2])>=10586?Number(e[2])>=14931?3:2:1}if("CI"in s)return["TRAVIS","CIRCLECI","APPVEYOR","GITLAB_CI"].some(e=>e in s)||"codeship"===s.CI_NAME?1:t;if("TEAMCITY_VERSION"in s)return/^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(s.TEAMCITY_VERSION)?1:0;if("truecolor"===s.COLORTERM)return 3;if("TERM_PROGRAM"in s){const e=parseInt((s.TERM_PROGRAM_VERSION||"").split(".")[0],10);switch(s.TERM_PROGRAM){case"iTerm.app":return e>=3?3:2;case"Apple_Terminal":return 2}}return/-256(color)?$/i.test(s.TERM)?2:/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(s.TERM)?1:"COLORTERM"in s?1:(s.TERM,t)}(e))}i("no-color")||i("no-colors")||i("color=false")?o=!1:(i("color")||i("colors")||i("color=true")||i("color=always"))&&(o=!0),"FORCE_COLOR"in s&&(o=0===s.FORCE_COLOR.length||0!==parseInt(s.FORCE_COLOR,10)),e.exports={supportsColor:a,stdout:a(process.stdout),stderr:a(process.stderr)}},function(e,t,r){"use strict";e.exports=(e,t)=>{t=t||process.argv;const r=e.startsWith("-")?"":1===e.length?"-":"--",n=t.indexOf(r+e),i=t.indexOf("--");return-1!==n&&(-1===i||n<i)}},function(e,t,r){"use strict";const n=/(?:\\(u[a-f\d]{4}|x[a-f\d]{2}|.))|(?:\{(~)?(\w+(?:\([^)]*\))?(?:\.\w+(?:\([^)]*\))?)*)(?:[ \t]|(?=\r?\n)))|(\})|((?:.|[\r\n\f])+?)/gi,i=/(?:^|\.)(\w+)(?:\(([^)]*)\))?/g,s=/^(['"])((?:\\.|(?!\1)[^\\])*)\1$/,o=/\\(u[a-f\d]{4}|x[a-f\d]{2}|.)|([^\\])/gi,a=new Map([["n","\n"],["r","\r"],["t","\t"],["b","\b"],["f","\f"],["v","\v"],["0","\0"],["\\","\\"],["e",""],["a",""]]);function c(e){return"u"===e[0]&&5===e.length||"x"===e[0]&&3===e.length?String.fromCharCode(parseInt(e.slice(1),16)):a.get(e)||e}function l(e,t){const r=[],n=t.trim().split(/\s*,\s*/g);let i;for(const t of n)if(isNaN(t)){if(!(i=t.match(s)))throw new Error(`Invalid Chalk template style argument: ${t} (in style '${e}')`);r.push(i[2].replace(o,(e,t,r)=>t?c(t):r))}else r.push(Number(t));return r}function u(e){i.lastIndex=0;const t=[];let r;for(;null!==(r=i.exec(e));){const e=r[1];if(r[2]){const n=l(e,r[2]);t.push([e].concat(n))}else t.push([e])}return t}function h(e,t){const r={};for(const e of t)for(const t of e.styles)r[t[0]]=e.inverse?null:t.slice(1);let n=e;for(const e of Object.keys(r))if(Array.isArray(r[e])){if(!(e in n))throw new Error(`Unknown Chalk style: ${e}`);n=r[e].length>0?n[e].apply(n,r[e]):n[e]}return n}e.exports=(e,t)=>{const r=[],i=[];let s=[];if(t.replace(n,(t,n,o,a,l,f)=>{if(n)s.push(c(n));else if(a){const t=s.join("");s=[],i.push(0===r.length?t:h(e,r)(t)),r.push({inverse:o,styles:u(a)})}else if(l){if(0===r.length)throw new Error("Found extraneous } in Chalk template literal");i.push(h(e,r)(s.join(""))),s=[],r.pop()}else s.push(f)}),i.push(s.join("")),r.length>0){const e=`Chalk template literal is missing ${r.length} closing bracket${1===r.length?"":"s"} (\`}\`)`;throw new Error(e)}return i.join("")}},function(e,t,r){var n;!function(i){"use strict";var s,o,a,c=(s=/d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZWN]|"[^"]*"|'[^']*'/g,o=/\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,a=/[^-+\dA-Z]/g,function(e,t,r,n){if(1!==arguments.length||"string"!==f(e)||/\d/.test(e)||(t=e,e=void 0),(e=e||new Date)instanceof Date||(e=new Date(e)),isNaN(e))throw TypeError("Invalid date");var i=(t=String(c.masks[t]||t||c.masks.default)).slice(0,4);"UTC:"!==i&&"GMT:"!==i||(t=t.slice(4),r=!0,"GMT:"===i&&(n=!0));var p=r?"getUTC":"get",d=e[p+"Date"](),y=e[p+"Day"](),m=e[p+"Month"](),g=e[p+"FullYear"](),v=e[p+"Hours"](),b=e[p+"Minutes"](),_=e[p+"Seconds"](),w=e[p+"Milliseconds"](),S=r?0:e.getTimezoneOffset(),k=u(e),O=h(e),x={d:d,dd:l(d),ddd:c.i18n.dayNames[y],dddd:c.i18n.dayNames[y+7],m:m+1,mm:l(m+1),mmm:c.i18n.monthNames[m],mmmm:c.i18n.monthNames[m+12],yy:String(g).slice(2),yyyy:g,h:v%12||12,hh:l(v%12||12),H:v,HH:l(v),M:b,MM:l(b),s:_,ss:l(_),l:l(w,3),L:l(Math.round(w/10)),t:v<12?c.i18n.timeNames[0]:c.i18n.timeNames[1],tt:v<12?c.i18n.timeNames[2]:c.i18n.timeNames[3],T:v<12?c.i18n.timeNames[4]:c.i18n.timeNames[5],TT:v<12?c.i18n.timeNames[6]:c.i18n.timeNames[7],Z:n?"GMT":r?"UTC":(String(e).match(o)||[""]).pop().replace(a,""),o:(S>0?"-":"+")+l(100*Math.floor(Math.abs(S)/60)+Math.abs(S)%60,4),S:["th","st","nd","rd"][d%10>3?0:(d%100-d%10!=10)*d%10],W:k,N:O};return t.replace(s,(function(e){return e in x?x[e]:e.slice(1,e.length-1)}))});function l(e,t){for(e=String(e),t=t||2;e.length<t;)e="0"+e;return e}function u(e){var t=new Date(e.getFullYear(),e.getMonth(),e.getDate());t.setDate(t.getDate()-(t.getDay()+6)%7+3);var r=new Date(t.getFullYear(),0,4);r.setDate(r.getDate()-(r.getDay()+6)%7+3);var n=t.getTimezoneOffset()-r.getTimezoneOffset();t.setHours(t.getHours()-n);var i=(t-r)/6048e5;return 1+Math.floor(i)}function h(e){var t=e.getDay();return 0===t&&(t=7),t}function f(e){return null===e?"null":void 0===e?"undefined":"object"!=typeof e?typeof e:Array.isArray(e)?"array":{}.toString.call(e).slice(8,-1).toLowerCase()}c.masks={default:"ddd mmm dd yyyy HH:MM:ss",shortDate:"m/d/yy",mediumDate:"mmm d, yyyy",longDate:"mmmm d, yyyy",fullDate:"dddd, mmmm d, yyyy",shortTime:"h:MM TT",mediumTime:"h:MM:ss TT",longTime:"h:MM:ss TT Z",isoDate:"yyyy-mm-dd",isoTime:"HH:MM:ss",isoDateTime:"yyyy-mm-dd'T'HH:MM:sso",isoUtcDateTime:"UTC:yyyy-mm-dd'T'HH:MM:ss'Z'",expiresHeaderFormat:"ddd, dd mmm yyyy HH:MM:ss Z"},c.i18n={dayNames:["Sun","Mon","Tue","Wed","Thu","Fri","Sat","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],monthNames:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","January","February","March","April","May","June","July","August","September","October","November","December"],timeNames:["a","p","am","pm","A","P","AM","PM"]},void 0===(n=function(){return c}.call(t,r,t,e))||(e.exports=n)}()},function(e,t,r){"use strict";e.exports=function e(t){if(!(this instanceof e))return new e(t);this.err=null,this.value=null;try{this.value=JSON.parse(t)}catch(e){this.err=e}}},function(e,t,r){!function(e){"use strict";function t(e){return null!==e&&"[object Array]"===Object.prototype.toString.call(e)}function r(e){return null!==e&&"[object Object]"===Object.prototype.toString.call(e)}function n(e,i){if(e===i)return!0;if(Object.prototype.toString.call(e)!==Object.prototype.toString.call(i))return!1;if(!0===t(e)){if(e.length!==i.length)return!1;for(var s=0;s<e.length;s++)if(!1===n(e[s],i[s]))return!1;return!0}if(!0===r(e)){var o={};for(var a in e)if(hasOwnProperty.call(e,a)){if(!1===n(e[a],i[a]))return!1;o[a]=!0}for(var c in i)if(hasOwnProperty.call(i,c)&&!0!==o[c])return!1;return!0}return!1}function i(e){if(""===e||!1===e||null===e)return!0;if(t(e)&&0===e.length)return!0;if(r(e)){for(var n in e)if(e.hasOwnProperty(n))return!1;return!0}return!1}var s;s="function"==typeof String.prototype.trimLeft?function(e){return e.trimLeft()}:function(e){return e.match(/^\s*(.*)/)[1]};var o=0,a=1,c=2,l=3,u=4,h=6,f=8,p=9,d={".":"Dot","*":"Star",",":"Comma",":":"Colon","{":"Lbrace","}":"Rbrace","]":"Rbracket","(":"Lparen",")":"Rparen","@":"Current"},y={"<":!0,">":!0,"=":!0,"!":!0},m={" ":!0,"\t":!0,"\n":!0};function g(e){return e>="0"&&e<="9"||"-"===e}function v(){}v.prototype={tokenize:function(e){var t,r,n,i,s=[];for(this._current=0;this._current<e.length;)if((i=e[this._current])>="a"&&i<="z"||i>="A"&&i<="Z"||"_"===i)t=this._current,r=this._consumeUnquotedIdentifier(e),s.push({type:"UnquotedIdentifier",value:r,start:t});else if(void 0!==d[e[this._current]])s.push({type:d[e[this._current]],value:e[this._current],start:this._current}),this._current++;else if(g(e[this._current]))n=this._consumeNumber(e),s.push(n);else if("["===e[this._current])n=this._consumeLBracket(e),s.push(n);else if('"'===e[this._current])t=this._current,r=this._consumeQuotedIdentifier(e),s.push({type:"QuotedIdentifier",value:r,start:t});else if("'"===e[this._current])t=this._current,r=this._consumeRawStringLiteral(e),s.push({type:"Literal",value:r,start:t});else if("`"===e[this._current]){t=this._current;var o=this._consumeLiteral(e);s.push({type:"Literal",value:o,start:t})}else if(void 0!==y[e[this._current]])s.push(this._consumeOperator(e));else if(void 0!==m[e[this._current]])this._current++;else if("&"===e[this._current])t=this._current,this._current++,"&"===e[this._current]?(this._current++,s.push({type:"And",value:"&&",start:t})):s.push({type:"Expref",value:"&",start:t});else{if("|"!==e[this._current]){var a=new Error("Unknown character:"+e[this._current]);throw a.name="LexerError",a}t=this._current,this._current++,"|"===e[this._current]?(this._current++,s.push({type:"Or",value:"||",start:t})):s.push({type:"Pipe",value:"|",start:t})}return s},_consumeUnquotedIdentifier:function(e){var t,r=this._current;for(this._current++;this._current<e.length&&((t=e[this._current])>="a"&&t<="z"||t>="A"&&t<="Z"||t>="0"&&t<="9"||"_"===t);)this._current++;return e.slice(r,this._current)},_consumeQuotedIdentifier:function(e){var t=this._current;this._current++;for(var r=e.length;'"'!==e[this._current]&&this._current<r;){var n=this._current;"\\"!==e[n]||"\\"!==e[n+1]&&'"'!==e[n+1]?n++:n+=2,this._current=n}return this._current++,JSON.parse(e.slice(t,this._current))},_consumeRawStringLiteral:function(e){var t=this._current;this._current++;for(var r=e.length;"'"!==e[this._current]&&this._current<r;){var n=this._current;"\\"!==e[n]||"\\"!==e[n+1]&&"'"!==e[n+1]?n++:n+=2,this._current=n}return this._current++,e.slice(t+1,this._current-1).replace("\\'","'")},_consumeNumber:function(e){var t=this._current;this._current++;for(var r=e.length;g(e[this._current])&&this._current<r;)this._current++;return{type:"Number",value:parseInt(e.slice(t,this._current)),start:t}},_consumeLBracket:function(e){var t=this._current;return this._current++,"?"===e[this._current]?(this._current++,{type:"Filter",value:"[?",start:t}):"]"===e[this._current]?(this._current++,{type:"Flatten",value:"[]",start:t}):{type:"Lbracket",value:"[",start:t}},_consumeOperator:function(e){var t=this._current,r=e[t];return this._current++,"!"===r?"="===e[this._current]?(this._current++,{type:"NE",value:"!=",start:t}):{type:"Not",value:"!",start:t}:"<"===r?"="===e[this._current]?(this._current++,{type:"LTE",value:"<=",start:t}):{type:"LT",value:"<",start:t}:">"===r?"="===e[this._current]?(this._current++,{type:"GTE",value:">=",start:t}):{type:"GT",value:">",start:t}:"="===r&&"="===e[this._current]?(this._current++,{type:"EQ",value:"==",start:t}):void 0},_consumeLiteral:function(e){this._current++;for(var t,r=this._current,n=e.length;"`"!==e[this._current]&&this._current<n;){var i=this._current;"\\"!==e[i]||"\\"!==e[i+1]&&"`"!==e[i+1]?i++:i+=2,this._current=i}var o=s(e.slice(r,this._current));return o=o.replace("\\`","`"),t=this._looksLikeJSON(o)?JSON.parse(o):JSON.parse('"'+o+'"'),this._current++,t},_looksLikeJSON:function(e){if(""===e)return!1;if('[{"'.indexOf(e[0])>=0)return!0;if(["true","false","null"].indexOf(e)>=0)return!0;if(!("-0123456789".indexOf(e[0])>=0))return!1;try{return JSON.parse(e),!0}catch(e){return!1}}};var b={};function _(){}function w(e){this.runtime=e}function S(e){this._interpreter=e,this.functionTable={abs:{_func:this._functionAbs,_signature:[{types:[o]}]},avg:{_func:this._functionAvg,_signature:[{types:[f]}]},ceil:{_func:this._functionCeil,_signature:[{types:[o]}]},contains:{_func:this._functionContains,_signature:[{types:[c,l]},{types:[a]}]},ends_with:{_func:this._functionEndsWith,_signature:[{types:[c]},{types:[c]}]},floor:{_func:this._functionFloor,_signature:[{types:[o]}]},length:{_func:this._functionLength,_signature:[{types:[c,l,u]}]},map:{_func:this._functionMap,_signature:[{types:[h]},{types:[l]}]},max:{_func:this._functionMax,_signature:[{types:[f,p]}]},merge:{_func:this._functionMerge,_signature:[{types:[u],variadic:!0}]},max_by:{_func:this._functionMaxBy,_signature:[{types:[l]},{types:[h]}]},sum:{_func:this._functionSum,_signature:[{types:[f]}]},starts_with:{_func:this._functionStartsWith,_signature:[{types:[c]},{types:[c]}]},min:{_func:this._functionMin,_signature:[{types:[f,p]}]},min_by:{_func:this._functionMinBy,_signature:[{types:[l]},{types:[h]}]},type:{_func:this._functionType,_signature:[{types:[a]}]},keys:{_func:this._functionKeys,_signature:[{types:[u]}]},values:{_func:this._functionValues,_signature:[{types:[u]}]},sort:{_func:this._functionSort,_signature:[{types:[p,f]}]},sort_by:{_func:this._functionSortBy,_signature:[{types:[l]},{types:[h]}]},join:{_func:this._functionJoin,_signature:[{types:[c]},{types:[p]}]},reverse:{_func:this._functionReverse,_signature:[{types:[c,l]}]},to_array:{_func:this._functionToArray,_signature:[{types:[a]}]},to_string:{_func:this._functionToString,_signature:[{types:[a]}]},to_number:{_func:this._functionToNumber,_signature:[{types:[a]}]},not_null:{_func:this._functionNotNull,_signature:[{types:[a],variadic:!0}]}}}b.EOF=0,b.UnquotedIdentifier=0,b.QuotedIdentifier=0,b.Rbracket=0,b.Rparen=0,b.Comma=0,b.Rbrace=0,b.Number=0,b.Current=0,b.Expref=0,b.Pipe=1,b.Or=2,b.And=3,b.EQ=5,b.GT=5,b.LT=5,b.GTE=5,b.LTE=5,b.NE=5,b.Flatten=9,b.Star=20,b.Filter=21,b.Dot=40,b.Not=45,b.Lbrace=50,b.Lbracket=55,b.Lparen=60,_.prototype={parse:function(e){this._loadTokens(e),this.index=0;var t=this.expression(0);if("EOF"!==this._lookahead(0)){var r=this._lookaheadToken(0),n=new Error("Unexpected token type: "+r.type+", value: "+r.value);throw n.name="ParserError",n}return t},_loadTokens:function(e){var t=(new v).tokenize(e);t.push({type:"EOF",value:"",start:e.length}),this.tokens=t},expression:function(e){var t=this._lookaheadToken(0);this._advance();for(var r=this.nud(t),n=this._lookahead(0);e<b[n];)this._advance(),r=this.led(n,r),n=this._lookahead(0);return r},_lookahead:function(e){return this.tokens[this.index+e].type},_lookaheadToken:function(e){return this.tokens[this.index+e]},_advance:function(){this.index++},nud:function(e){var t,r;switch(e.type){case"Literal":return{type:"Literal",value:e.value};case"UnquotedIdentifier":return{type:"Field",name:e.value};case"QuotedIdentifier":var n={type:"Field",name:e.value};if("Lparen"===this._lookahead(0))throw new Error("Quoted identifier not allowed for function names.");return n;case"Not":return{type:"NotExpression",children:[t=this.expression(b.Not)]};case"Star":return t=null,{type:"ValueProjection",children:[{type:"Identity"},t="Rbracket"===this._lookahead(0)?{type:"Identity"}:this._parseProjectionRHS(b.Star)]};case"Filter":return this.led(e.type,{type:"Identity"});case"Lbrace":return this._parseMultiselectHash();case"Flatten":return{type:"Projection",children:[{type:"Flatten",children:[{type:"Identity"}]},t=this._parseProjectionRHS(b.Flatten)]};case"Lbracket":return"Number"===this._lookahead(0)||"Colon"===this._lookahead(0)?(t=this._parseIndexExpression(),this._projectIfSlice({type:"Identity"},t)):"Star"===this._lookahead(0)&&"Rbracket"===this._lookahead(1)?(this._advance(),this._advance(),{type:"Projection",children:[{type:"Identity"},t=this._parseProjectionRHS(b.Star)]}):this._parseMultiselectList();case"Current":return{type:"Current"};case"Expref":return{type:"ExpressionReference",children:[r=this.expression(b.Expref)]};case"Lparen":for(var i=[];"Rparen"!==this._lookahead(0);)"Current"===this._lookahead(0)?(r={type:"Current"},this._advance()):r=this.expression(0),i.push(r);return this._match("Rparen"),i[0];default:this._errorToken(e)}},led:function(e,t){var r;switch(e){case"Dot":var n=b.Dot;return"Star"!==this._lookahead(0)?{type:"Subexpression",children:[t,r=this._parseDotRHS(n)]}:(this._advance(),{type:"ValueProjection",children:[t,r=this._parseProjectionRHS(n)]});case"Pipe":return{type:"Pipe",children:[t,r=this.expression(b.Pipe)]};case"Or":return{type:"OrExpression",children:[t,r=this.expression(b.Or)]};case"And":return{type:"AndExpression",children:[t,r=this.expression(b.And)]};case"Lparen":for(var i,s=t.name,o=[];"Rparen"!==this._lookahead(0);)"Current"===this._lookahead(0)?(i={type:"Current"},this._advance()):i=this.expression(0),"Comma"===this._lookahead(0)&&this._match("Comma"),o.push(i);return this._match("Rparen"),{type:"Function",name:s,children:o};case"Filter":var a=this.expression(0);return this._match("Rbracket"),{type:"FilterProjection",children:[t,r="Flatten"===this._lookahead(0)?{type:"Identity"}:this._parseProjectionRHS(b.Filter),a]};case"Flatten":return{type:"Projection",children:[{type:"Flatten",children:[t]},this._parseProjectionRHS(b.Flatten)]};case"EQ":case"NE":case"GT":case"GTE":case"LT":case"LTE":return this._parseComparator(t,e);case"Lbracket":var c=this._lookaheadToken(0);return"Number"===c.type||"Colon"===c.type?(r=this._parseIndexExpression(),this._projectIfSlice(t,r)):(this._match("Star"),this._match("Rbracket"),{type:"Projection",children:[t,r=this._parseProjectionRHS(b.Star)]});default:this._errorToken(this._lookaheadToken(0))}},_match:function(e){if(this._lookahead(0)!==e){var t=this._lookaheadToken(0),r=new Error("Expected "+e+", got: "+t.type);throw r.name="ParserError",r}this._advance()},_errorToken:function(e){var t=new Error("Invalid token ("+e.type+'): "'+e.value+'"');throw t.name="ParserError",t},_parseIndexExpression:function(){if("Colon"===this._lookahead(0)||"Colon"===this._lookahead(1))return this._parseSliceExpression();var e={type:"Index",value:this._lookaheadToken(0).value};return this._advance(),this._match("Rbracket"),e},_projectIfSlice:function(e,t){var r={type:"IndexExpression",children:[e,t]};return"Slice"===t.type?{type:"Projection",children:[r,this._parseProjectionRHS(b.Star)]}:r},_parseSliceExpression:function(){for(var e=[null,null,null],t=0,r=this._lookahead(0);"Rbracket"!==r&&t<3;){if("Colon"===r)t++,this._advance();else{if("Number"!==r){var n=this._lookahead(0),i=new Error("Syntax error, unexpected token: "+n.value+"("+n.type+")");throw i.name="Parsererror",i}e[t]=this._lookaheadToken(0).value,this._advance()}r=this._lookahead(0)}return this._match("Rbracket"),{type:"Slice",children:e}},_parseComparator:function(e,t){return{type:"Comparator",name:t,children:[e,this.expression(b[t])]}},_parseDotRHS:function(e){var t=this._lookahead(0);return["UnquotedIdentifier","QuotedIdentifier","Star"].indexOf(t)>=0?this.expression(e):"Lbracket"===t?(this._match("Lbracket"),this._parseMultiselectList()):"Lbrace"===t?(this._match("Lbrace"),this._parseMultiselectHash()):void 0},_parseProjectionRHS:function(e){var t;if(b[this._lookahead(0)]<10)t={type:"Identity"};else if("Lbracket"===this._lookahead(0))t=this.expression(e);else if("Filter"===this._lookahead(0))t=this.expression(e);else{if("Dot"!==this._lookahead(0)){var r=this._lookaheadToken(0),n=new Error("Sytanx error, unexpected token: "+r.value+"("+r.type+")");throw n.name="ParserError",n}this._match("Dot"),t=this._parseDotRHS(e)}return t},_parseMultiselectList:function(){for(var e=[];"Rbracket"!==this._lookahead(0);){var t=this.expression(0);if(e.push(t),"Comma"===this._lookahead(0)&&(this._match("Comma"),"Rbracket"===this._lookahead(0)))throw new Error("Unexpected token Rbracket")}return this._match("Rbracket"),{type:"MultiSelectList",children:e}},_parseMultiselectHash:function(){for(var e,t,r,n=[],i=["UnquotedIdentifier","QuotedIdentifier"];;){if(e=this._lookaheadToken(0),i.indexOf(e.type)<0)throw new Error("Expecting an identifier token, got: "+e.type);if(t=e.value,this._advance(),this._match("Colon"),r={type:"KeyValuePair",name:t,value:this.expression(0)},n.push(r),"Comma"===this._lookahead(0))this._match("Comma");else if("Rbrace"===this._lookahead(0)){this._match("Rbrace");break}}return{type:"MultiSelectHash",children:n}}},w.prototype={search:function(e,t){return this.visit(e,t)},visit:function(e,s){var o,a,c,l,u,h,f,p,d;switch(e.type){case"Field":return null===s?null:r(s)?void 0===(h=s[e.name])?null:h:null;case"Subexpression":for(c=this.visit(e.children[0],s),d=1;d<e.children.length;d++)if(null===(c=this.visit(e.children[1],c)))return null;return c;case"IndexExpression":return f=this.visit(e.children[0],s),this.visit(e.children[1],f);case"Index":if(!t(s))return null;var y=e.value;return y<0&&(y=s.length+y),void 0===(c=s[y])&&(c=null),c;case"Slice":if(!t(s))return null;var m=e.children.slice(0),g=this.computeSliceParams(s.length,m),v=g[0],b=g[1],_=g[2];if(c=[],_>0)for(d=v;d<b;d+=_)c.push(s[d]);else for(d=v;d>b;d+=_)c.push(s[d]);return c;case"Projection":var w=this.visit(e.children[0],s);if(!t(w))return null;for(p=[],d=0;d<w.length;d++)null!==(a=this.visit(e.children[1],w[d]))&&p.push(a);return p;case"ValueProjection":if(!r(w=this.visit(e.children[0],s)))return null;p=[];var S=function(e){for(var t=Object.keys(e),r=[],n=0;n<t.length;n++)r.push(e[t[n]]);return r}(w);for(d=0;d<S.length;d++)null!==(a=this.visit(e.children[1],S[d]))&&p.push(a);return p;case"FilterProjection":if(!t(w=this.visit(e.children[0],s)))return null;var k=[],O=[];for(d=0;d<w.length;d++)i(o=this.visit(e.children[2],w[d]))||k.push(w[d]);for(var x=0;x<k.length;x++)null!==(a=this.visit(e.children[1],k[x]))&&O.push(a);return O;case"Comparator":switch(l=this.visit(e.children[0],s),u=this.visit(e.children[1],s),e.name){case"EQ":c=n(l,u);break;case"NE":c=!n(l,u);break;case"GT":c=l>u;break;case"GTE":c=l>=u;break;case"LT":c=l<u;break;case"LTE":c=l<=u;break;default:throw new Error("Unknown comparator: "+e.name)}return c;case"Flatten":var j=this.visit(e.children[0],s);if(!t(j))return null;var E=[];for(d=0;d<j.length;d++)t(a=j[d])?E.push.apply(E,a):E.push(a);return E;case"Identity":return s;case"MultiSelectList":if(null===s)return null;for(p=[],d=0;d<e.children.length;d++)p.push(this.visit(e.children[d],s));return p;case"MultiSelectHash":if(null===s)return null;var M;for(p={},d=0;d<e.children.length;d++)p[(M=e.children[d]).name]=this.visit(M.value,s);return p;case"OrExpression":return i(o=this.visit(e.children[0],s))&&(o=this.visit(e.children[1],s)),o;case"AndExpression":return!0===i(l=this.visit(e.children[0],s))?l:this.visit(e.children[1],s);case"NotExpression":return i(l=this.visit(e.children[0],s));case"Literal":return e.value;case"Pipe":return f=this.visit(e.children[0],s),this.visit(e.children[1],f);case"Current":return s;case"Function":var T=[];for(d=0;d<e.children.length;d++)T.push(this.visit(e.children[d],s));return this.runtime.callFunction(e.name,T);case"ExpressionReference":var L=e.children[0];return L.jmespathType="Expref",L;default:throw new Error("Unknown node type: "+e.type)}},computeSliceParams:function(e,t){var r=t[0],n=t[1],i=t[2],s=[null,null,null];if(null===i)i=1;else if(0===i){var o=new Error("Invalid slice, step cannot be 0");throw o.name="RuntimeError",o}var a=i<0;return r=null===r?a?e-1:0:this.capSliceRange(e,r,i),n=null===n?a?-1:e:this.capSliceRange(e,n,i),s[0]=r,s[1]=n,s[2]=i,s},capSliceRange:function(e,t,r){return t<0?(t+=e)<0&&(t=r<0?-1:0):t>=e&&(t=r<0?e-1:e),t}},S.prototype={callFunction:function(e,t){var r=this.functionTable[e];if(void 0===r)throw new Error("Unknown function: "+e+"()");return this._validateArgs(e,t,r._signature),r._func.call(this,t)},_validateArgs:function(e,t,r){var n,i,s,o;if(r[r.length-1].variadic){if(t.length<r.length)throw n=1===r.length?" argument":" arguments",new Error("ArgumentError: "+e+"() takes at least"+r.length+n+" but received "+t.length)}else if(t.length!==r.length)throw n=1===r.length?" argument":" arguments",new Error("ArgumentError: "+e+"() takes "+r.length+n+" but received "+t.length);for(var a=0;a<r.length;a++){o=!1,i=r[a].types,s=this._getTypeName(t[a]);for(var c=0;c<i.length;c++)if(this._typeMatches(s,i[c],t[a])){o=!0;break}if(!o)throw new Error("TypeError: "+e+"() expected argument "+(a+1)+" to be type "+i+" but received type "+s+" instead.")}},_typeMatches:function(e,t,r){if(t===a)return!0;if(t!==p&&t!==f&&t!==l)return e===t;if(t===l)return e===l;if(e===l){var n;t===f?n=o:t===p&&(n=c);for(var i=0;i<r.length;i++)if(!this._typeMatches(this._getTypeName(r[i]),n,r[i]))return!1;return!0}},_getTypeName:function(e){switch(Object.prototype.toString.call(e)){case"[object String]":return c;case"[object Number]":return o;case"[object Array]":return l;case"[object Boolean]":return 5;case"[object Null]":return 7;case"[object Object]":return"Expref"===e.jmespathType?h:u}},_functionStartsWith:function(e){return 0===e[0].lastIndexOf(e[1])},_functionEndsWith:function(e){var t=e[0],r=e[1];return-1!==t.indexOf(r,t.length-r.length)},_functionReverse:function(e){if(this._getTypeName(e[0])===c){for(var t=e[0],r="",n=t.length-1;n>=0;n--)r+=t[n];return r}var i=e[0].slice(0);return i.reverse(),i},_functionAbs:function(e){return Math.abs(e[0])},_functionCeil:function(e){return Math.ceil(e[0])},_functionAvg:function(e){for(var t=0,r=e[0],n=0;n<r.length;n++)t+=r[n];return t/r.length},_functionContains:function(e){return e[0].indexOf(e[1])>=0},_functionFloor:function(e){return Math.floor(e[0])},_functionLength:function(e){return r(e[0])?Object.keys(e[0]).length:e[0].length},_functionMap:function(e){for(var t=[],r=this._interpreter,n=e[0],i=e[1],s=0;s<i.length;s++)t.push(r.visit(n,i[s]));return t},_functionMerge:function(e){for(var t={},r=0;r<e.length;r++){var n=e[r];for(var i in n)t[i]=n[i]}return t},_functionMax:function(e){if(e[0].length>0){if(this._getTypeName(e[0][0])===o)return Math.max.apply(Math,e[0]);for(var t=e[0],r=t[0],n=1;n<t.length;n++)r.localeCompare(t[n])<0&&(r=t[n]);return r}return null},_functionMin:function(e){if(e[0].length>0){if(this._getTypeName(e[0][0])===o)return Math.min.apply(Math,e[0]);for(var t=e[0],r=t[0],n=1;n<t.length;n++)t[n].localeCompare(r)<0&&(r=t[n]);return r}return null},_functionSum:function(e){for(var t=0,r=e[0],n=0;n<r.length;n++)t+=r[n];return t},_functionType:function(e){switch(this._getTypeName(e[0])){case o:return"number";case c:return"string";case l:return"array";case u:return"object";case 5:return"boolean";case h:return"expref";case 7:return"null"}},_functionKeys:function(e){return Object.keys(e[0])},_functionValues:function(e){for(var t=e[0],r=Object.keys(t),n=[],i=0;i<r.length;i++)n.push(t[r[i]]);return n},_functionJoin:function(e){var t=e[0];return e[1].join(t)},_functionToArray:function(e){return this._getTypeName(e[0])===l?e[0]:[e[0]]},_functionToString:function(e){return this._getTypeName(e[0])===c?e[0]:JSON.stringify(e[0])},_functionToNumber:function(e){var t,r=this._getTypeName(e[0]);return r===o?e[0]:r!==c||(t=+e[0],isNaN(t))?null:t},_functionNotNull:function(e){for(var t=0;t<e.length;t++)if(7!==this._getTypeName(e[t]))return e[t];return null},_functionSort:function(e){var t=e[0].slice(0);return t.sort(),t},_functionSortBy:function(e){var t=e[0].slice(0);if(0===t.length)return t;var r=this._interpreter,n=e[1],i=this._getTypeName(r.visit(n,t[0]));if([o,c].indexOf(i)<0)throw new Error("TypeError");for(var s=this,a=[],l=0;l<t.length;l++)a.push([l,t[l]]);a.sort((function(e,t){var o=r.visit(n,e[1]),a=r.visit(n,t[1]);if(s._getTypeName(o)!==i)throw new Error("TypeError: expected "+i+", received "+s._getTypeName(o));if(s._getTypeName(a)!==i)throw new Error("TypeError: expected "+i+", received "+s._getTypeName(a));return o>a?1:o<a?-1:e[0]-t[0]}));for(var u=0;u<a.length;u++)t[u]=a[u][1];return t},_functionMaxBy:function(e){for(var t,r,n=e[1],i=e[0],s=this.createKeyFunction(n,[o,c]),a=-1/0,l=0;l<i.length;l++)(r=s(i[l]))>a&&(a=r,t=i[l]);return t},_functionMinBy:function(e){for(var t,r,n=e[1],i=e[0],s=this.createKeyFunction(n,[o,c]),a=1/0,l=0;l<i.length;l++)(r=s(i[l]))<a&&(a=r,t=i[l]);return t},createKeyFunction:function(e,t){var r=this,n=this._interpreter;return function(i){var s=n.visit(e,i);if(t.indexOf(r._getTypeName(s))<0){var o="TypeError: expected one of "+t+", received "+r._getTypeName(s);throw new Error(o)}return s}}},e.tokenize=function(e){return(new v).tokenize(e)},e.compile=function(e){return(new _).parse(e)},e.search=function(e,t){var r=new _,n=new S,i=new w(n);n._interpreter=i;var s=r.parse(t);return i.search(s,e)},e.strictDeepEqual=n}(t)},function(e,t,r){"use strict";e.exports={DATE_FORMAT:"yyyy-mm-dd HH:MM:ss.l o",MESSAGE_KEY:"msg"}},function(e){e.exports={_from:"pino@5.10.6",_id:"pino@5.10.6",_inBundle:!1,_integrity:"sha512-iw6PRQ8l6iR56UO/LigaK2MIgfTD5GQUFXSRpw5SXJDlfwZsvQj1WJ1xK9747YG6aeL8KkVP1CdSp0+Avj1hNg==",_location:"/pino",_phantomChildren:{},_requested:{type:"version",registry:!0,raw:"pino@5.10.6",name:"pino",escapedName:"pino",rawSpec:"5.10.6",saveSpec:null,fetchSpec:"5.10.6"},_requiredBy:["/"],_resolved:"https://registry.npmjs.org/pino/-/pino-5.10.6.tgz",_shasum:"bfd3981ac086ace1ca0d900ae3fb58ab30fba30d",_spec:"pino@5.10.6",_where:"/Users/tylerchong/Desktop/workspace/code/lost-in-translation",author:{name:"Matteo Collina",email:"hello@matteocollina.com"},bin:{pino:"./bin.js"},browser:"./browser.js",bugs:{url:"https://github.com/pinojs/pino/issues"},bundleDependencies:!1,contributors:[{name:"David Mark Clements",email:"huperekchuno@googlemail.com"},{name:"James Sumners",email:"james.sumners@gmail.com"},{name:"Thomas Watson Steen",email:"w@tson.dk",url:"https://twitter.com/wa7son"}],dependencies:{"fast-redact":"^1.4.2","fast-safe-stringify":"^2.0.6",flatstr:"^1.0.9","pino-std-serializers":"^2.3.0","quick-format-unescaped":"^3.0.0","sonic-boom":"^0.7.1"},deprecated:!1,description:"super fast, all natural json logger",devDependencies:{airtap:"0.1.0",benchmark:"^2.1.4",bole:"^3.0.2",bunyan:"^1.8.12","docsify-cli":"^4.2.1",execa:"^1.0.0",fastbench:"^1.0.1","flush-write-stream":"^1.0.3","fresh-require":"^1.0.3",log:"^3.0.0",loglevel:"^1.6.1","pino-pretty":"^2.4.0","pre-commit":"^1.2.2",proxyquire:"^2.1.0",pump:"^3.0.0",qodaa:"^1.0.1",snazzy:"^8.0.0",split2:"^3.0.0",standard:"^12.0.1",steed:"^1.1.3",tap:"^12.1.0",tape:"^4.9.0",through2:"^3.0.0",winston:"^3.1.0"},files:["pino.js","bin.js","browser.js","pretty.js","usage.txt","test","docs","example.js","lib"],homepage:"http://getpino.io",keywords:["fast","logger","stream","json"],license:"MIT",main:"pino.js",name:"pino",precommit:"test",repository:{type:"git",url:"git+https://github.com/pinojs/pino.git"},scripts:{bench:"node benchmarks/utils/runbench all","bench-basic":"node benchmarks/utils/runbench basic","bench-child":"node benchmarks/utils/runbench child","bench-child-child":"node benchmarks/utils/runbench child-child","bench-child-creation":"node benchmarks/utils/runbench child-creation","bench-deep-object":"node benchmarks/utils/runbench deep-object","bench-longs-tring":"node benchmarks/utils/runbench long-string","bench-multi-arg":"node benchmarks/utils/runbench multi-arg","bench-object":"node benchmarks/utils/runbench object","browser-test":"airtap --local 8080 test/browser*test.js",ci:"standard | snazzy && TAP_TIMEOUT=480000 NODE_OPTIONS='--no-warnings -r qodaa' tap -j 4 --100 test/*test.js","cov-ui":"NODE_OPTIONS='--no-warnings -r qodaa' tap -j 4 --coverage-report=html test/*test.js",docs:"docsify serve",test:"standard | snazzy && NODE_OPTIONS='--no-warnings -r qodaa' tap -j 4 --no-cov test/*test.js","update-bench-doc":"node benchmarks/utils/generate-benchmark-doc > docs/benchmarks.md"},version:"5.10.6"}},function(e,t,r){"use strict";r.r(t);var n=r(4),i=r(5),s=r(16),o=r.n(s),a=r(6),c=r.n(a);const l={name:"lost-in-translation-skill",level:process.env.LOGGER_LEVEL||"debug",prettyPrint:{levelFirst:!0},prettifier:c.a};var u=o()(l);r.d(t,"todayName",(function(){return f})),r.d(t,"addNumbers",(function(){return p}));const h=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];function f(e=i.Time){const t=e.serverTimeGetDay();return h[t]}function p(...e){return u.info(`the arguments are ${Object(n.inspect)(e)}`),Array.from(e).reduce((e,t)=>e+t,0)}}]));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8vbGliL3N5bWJvbHMuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2Zhc3QtcmVkYWN0L2xpYi9yeC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvZmxhdHN0ci9pbmRleC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvcGluby9saWIvdG9vbHMuanMiLCJ3ZWJwYWNrOi8vL2V4dGVybmFsIFwidXRpbFwiIiwid2VicGFjazovLy8uL2xpYi9zZXJ2aWNlcy90aW1lLnNlcnZpY2UuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8tcHJldHR5L2luZGV4LmpzIiwid2VicGFjazovLy9leHRlcm5hbCBcIm9zXCIiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8tc3RkLXNlcmlhbGl6ZXJzL2luZGV4LmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9mYXN0LXJlZGFjdC9saWIvbW9kaWZpZXJzLmpzIiwid2VicGFjazovLy9leHRlcm5hbCBcImV2ZW50c1wiIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9zb25pYy1ib29tL2luZGV4LmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9waW5vL2xpYi9sZXZlbHMuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2Zhc3Qtc2FmZS1zdHJpbmdpZnkvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2NvbG9yLWNvbnZlcnQvY29udmVyc2lvbnMuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8vbGliL21ldGEuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8vcGluby5qcyIsIndlYnBhY2s6Ly8vLi9saWIvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8tc3RkLXNlcmlhbGl6ZXJzL2xpYi9lcnIuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8tc3RkLXNlcmlhbGl6ZXJzL2xpYi9yZXEuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8tc3RkLXNlcmlhbGl6ZXJzL2xpYi9yZXMuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3Bpbm8vbGliL3JlZGFjdGlvbi5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvZmFzdC1yZWRhY3QvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2Zhc3QtcmVkYWN0L2xpYi92YWxpZGF0b3IuanMiLCJ3ZWJwYWNrOi8vL2V4dGVybmFsIFwidm1cIiIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvZmFzdC1yZWRhY3QvbGliL3BhcnNlLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9mYXN0LXJlZGFjdC9saWIvcmVkYWN0b3IuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2Zhc3QtcmVkYWN0L2xpYi9yZXN0b3Jlci5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvZmFzdC1yZWRhY3QvbGliL3N0YXRlLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9waW5vL2xpYi90aW1lLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9waW5vL2xpYi9wcm90by5qcyIsIndlYnBhY2s6Ly8vZXh0ZXJuYWwgXCJmc1wiIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9xdWljay1mb3JtYXQtdW5lc2NhcGVkL2luZGV4LmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9jaGFsay9pbmRleC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvZXNjYXBlLXN0cmluZy1yZWdleHAvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2Fuc2ktc3R5bGVzL2luZGV4LmpzIiwid2VicGFjazovLy8od2VicGFjaykvYnVpbGRpbi9tb2R1bGUuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2NvbG9yLWNvbnZlcnQvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2NvbG9yLW5hbWUvaW5kZXguanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2NvbG9yLWNvbnZlcnQvcm91dGUuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3N1cHBvcnRzLWNvbG9yL2luZGV4LmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9oYXMtZmxhZy9pbmRleC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvY2hhbGsvdGVtcGxhdGVzLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9kYXRlZm9ybWF0L2xpYi9kYXRlZm9ybWF0LmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9mYXN0LWpzb24tcGFyc2UvcGFyc2UuanMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2ptZXNwYXRoL2ptZXNwYXRoLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9waW5vLXByZXR0eS9saWIvY29uc3RhbnRzLmpzIiwid2VicGFjazovLy8uL2xpYi9jb21wb25lbnRzL2xvZ2dlci5qcyIsIndlYnBhY2s6Ly8vLi9saWIvY29tcG9uZW50cy91dGlscy5qcyJdLCJuYW1lcyI6WyJpbnN0YWxsZWRNb2R1bGVzIiwiX193ZWJwYWNrX3JlcXVpcmVfXyIsIm1vZHVsZUlkIiwiZXhwb3J0cyIsIm1vZHVsZSIsImkiLCJsIiwibW9kdWxlcyIsImNhbGwiLCJtIiwiYyIsImQiLCJuYW1lIiwiZ2V0dGVyIiwibyIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInIiLCJTeW1ib2wiLCJ0b1N0cmluZ1RhZyIsInZhbHVlIiwidCIsIm1vZGUiLCJfX2VzTW9kdWxlIiwibnMiLCJjcmVhdGUiLCJrZXkiLCJiaW5kIiwibiIsIm9iamVjdCIsInByb3BlcnR5IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJwIiwicyIsInNldExldmVsU3ltIiwiZ2V0TGV2ZWxTeW0iLCJsZXZlbFZhbFN5bSIsInVzZUxldmVsTGFiZWxzU3ltIiwiY2hhbmdlTGV2ZWxOYW1lU3ltIiwidXNlT25seUN1c3RvbUxldmVsc1N5bSIsImxzQ2FjaGVTeW0iLCJjaGluZGluZ3NTeW0iLCJwYXJzZWRDaGluZGluZ3NTeW0iLCJhc0pzb25TeW0iLCJ3cml0ZVN5bSIsInJlZGFjdEZtdFN5bSIsInRpbWVTeW0iLCJzdHJlYW1TeW0iLCJzdHJpbmdpZnlTeW0iLCJzdHJpbmdpZmllcnNTeW0iLCJlbmRTeW0iLCJmb3JtYXRPcHRzU3ltIiwibWVzc2FnZUtleVN0cmluZ1N5bSIsInNlcmlhbGl6ZXJzU3ltIiwiZm9yIiwid2lsZGNhcmRHc3ltIiwibmVlZHNNZXRhZGF0YUdzeW0iLCJmb3JtYXQiLCJtYXBIdHRwUmVxdWVzdCIsIm1hcEh0dHBSZXNwb25zZSIsIlNvbmljQm9vbSIsInN0cmluZ2lmeVNhZmUiLCJub29wIiwiYXNTdHJpbmciLCJzdHIiLCJyZXN1bHQiLCJsYXN0IiwiZm91bmQiLCJwb2ludCIsImxlbmd0aCIsIkpTT04iLCJzdHJpbmdpZnkiLCJjaGFyQ29kZUF0Iiwic2xpY2UiLCJnZXRQcmV0dHlTdHJlYW0iLCJvcHRzIiwicHJldHRpZmllciIsImRlc3QiLCJwcmV0dGlmaWVyTWV0YVdyYXBwZXIiLCJwcmV0dHlGYWN0b3J5IiwiYXNNZXRhV3JhcHBlciIsImUiLCJFcnJvciIsInByZXR0eSIsIndhcm5lZCIsImxhc3RMZXZlbCIsImxhc3RNc2ciLCJsYXN0T2JqIiwibGFzdExvZ2dlciIsIndyaXRlIiwiYXNzaWduIiwibGV2ZWwiLCJtc2ciLCJ0aW1lIiwiRGF0ZSIsIm5vdyIsInRoaXMiLCJjaGluZGluZ3MiLCJwYXJzZSIsImNodW5rIiwibGFzdFRpbWUiLCJtYXRjaCIsInBhcnNlSW50IiwiZXJyb3JQcm9wcyIsIm1lc3NhZ2UiLCJ0eXBlIiwic3RhY2siLCJvYmoiLCJzZXJpYWxpemVycyIsImtleXMiLCJ1bmRlZmluZWQiLCJyZWRhY3QiLCJmb3JtYXR0ZWQiLCJidWlsZFNhZmVTb25pY0Jvb20iLCJidWZmZXIiLCJzeW5jIiwic3RyZWFtIiwib24iLCJmaWx0ZXJCcm9rZW5QaXBlIiwiZXJyIiwiY29kZSIsImVuZCIsImZsdXNoU3luYyIsImRlc3Ryb3kiLCJyZW1vdmVMaXN0ZW5lciIsImVtaXQiLCJhc0NoaW5kaW5ncyIsImluc3RhbmNlIiwiYmluZGluZ3MiLCJkYXRhIiwic3RyaW5naWZpZXJzIiwiYXNKc29uIiwibnVtIiwiaGFzT2JqIiwib2JqRXJyb3IiLCJtZXNzYWdlS2V5U3RyaW5nIiwibm90SGFzT3duUHJvcGVydHkiLCJOdW1iZXIiLCJpc0Zpbml0ZSIsImdlbkxvZyIsInoiLCJtZXRob2QiLCJoZWFkZXJzIiwic29ja2V0Iiwic2V0SGVhZGVyIiwiY3JlYXRlQXJnc05vcm1hbGl6ZXIiLCJkZWZhdWx0T3B0aW9ucyIsIndyaXRhYmxlIiwiX3dyaXRhYmxlU3RhdGUiLCJlbmFibGVkIiwicHJldHR5UHJpbnQiLCJtZXNzYWdlS2V5IiwicHJvY2VzcyIsInN0ZG91dCIsImZkIiwiY29uc3RydWN0b3IiLCJoYXNCZWVuVGFtcGVyZWQiLCJmaW5hbCIsImxvZ2dlciIsImhhbmRsZXIiLCJjaGlsZCIsImhhc0hhbmRsZXIiLCJmaW5hbExvZ2dlciIsIlByb3h5IiwibGV2ZWxzIiwidmFsdWVzIiwiYXJncyIsIl8iLCJyZXF1aXJlIiwiVGltZSIsInNlcnZlclRpbWVHZXREYXkiLCJkYXRlIiwiZ2V0RGF5IiwiY2hhbGsiLCJkYXRlZm9ybWF0IiwianNvblBhcnNlciIsImptZXNwYXRoIiwiQ09OU1RBTlRTIiwiZGVmYXVsdCIsIjYwIiwiNTAiLCI0MCIsIjMwIiwiMjAiLCIxMCIsImNvbG9yaXplIiwic3VwcG9ydHNDb2xvciIsImNybGYiLCJlcnJvckxpa2VPYmplY3RLZXlzIiwibGV2ZWxGaXJzdCIsIk1FU1NBR0VfS0VZIiwidHJhbnNsYXRlVGltZSIsInVzZU1ldGFkYXRhIiwib3V0cHV0U3RyZWFtIiwibm9jb2xvciIsImlucHV0Iiwib3B0aW9ucyIsIkVPTCIsIklERU5UIiwic3BsaXQiLCJjb2xvciIsImN0eCIsIndoaXRlIiwiYmdSZWQiLCJyZWQiLCJ5ZWxsb3ciLCJncmVlbiIsImJsdWUiLCJncmV5IiwiY3lhbiIsInNlYXJjaCIsImlucHV0RGF0YSIsImxvZyIsInRvU3RyaW5nIiwiYXBwbHkiLCJwYXJzZWQiLCJ2IiwiaXNQaW5vTG9nIiwic3RhbmRhcmRLZXlzIiwiZXBvY2giLCJpbnN0YW50IiwiREFURV9GT1JNQVQiLCJ1cHBlckZvcm1hdCIsInRvVXBwZXJDYXNlIiwic3RhcnRzV2l0aCIsImZvcm1hdFRpbWUiLCJsaW5lIiwiY29sb3JlZExldmVsIiwicGlkIiwiaG9zdG5hbWUiLCJwcm9wc0ZvclByaW50Iiwiam9pbkxpbmVzV2l0aEluZGVudGF0aW9uIiwiZXhjbHVkZWRQcm9wcyIsImNvbmNhdCIsImZpbHRlciIsInByb3AiLCJpbmRleE9mIiwiZmlsdGVyT2JqZWN0cyIsImxpbmVzIiwiam9pbiIsImV4Y2x1ZGVTdGFuZGFyZEtleXMiLCJmaWx0ZXJlZEtleXMiLCJwdXNoIiwiQXJyYXkiLCJhcnJheU9mTGluZXMiLCJqIiwidGVzdCIsIm1hdGNoZXMiLCJleGVjIiwiaW5kZW50U2l6ZSIsImluZGVudGF0aW9uIiwicmVwZWF0IiwicmVwbGFjZSIsImVyclNlcmlhbGl6ZXIiLCJyZXFTZXJpYWxpemVycyIsInJlc1NlcmlhbGl6ZXJzIiwicmVxIiwicmVxU2VyaWFsaXplciIsInJlcyIsInJlc1NlcmlhbGl6ZXIiLCJ3cmFwRXJyb3JTZXJpYWxpemVyIiwiY3VzdG9tU2VyaWFsaXplciIsIndyYXBSZXF1ZXN0U2VyaWFsaXplciIsIndyYXBSZXNwb25zZVNlcmlhbGl6ZXIiLCJzcGVjaWFsU2V0IiwiayIsImYiLCJudiIsIm92IiwibGkiLCJvb3YiLCJleGlzdHMiLCJwYXJlbnQiLCJncm91cFJlZGFjdCIsInBhdGgiLCJjZW5zb3IiLCJpc0NlbnNvckZjdCIsInRhcmdldCIsImZsYXQiLCJncm91cFJlc3RvcmUiLCJuZXN0ZWRSZWRhY3QiLCJzdG9yZSIsIm5lc3RlZFJlc3RvcmUiLCJhcnIiLCJmcyIsIkV2ZW50RW1pdHRlciIsImZsYXRzdHIiLCJpbmhlcml0cyIsIk1BWF9XUklURSIsIm9wZW5GaWxlIiwiZmlsZSIsInNvbmljIiwiX29wZW5pbmciLCJfd3JpdGluZyIsIm9wZW4iLCJfcmVvcGVuaW5nIiwibGVuIiwiX2J1ZiIsIm1pbkxlbmd0aCIsImRlc3Ryb3llZCIsImFjdHVhbFdyaXRlIiwiX3dyaXRpbmdCdWYiLCJfZW5kaW5nIiwiX2FzeW5jRHJhaW5TY2hlZHVsZWQiLCJuZXh0VGljayIsInJlbGVhc2UiLCJzZXRUaW1lb3V0Iiwid3JpdGVTeW5jIiwicmVvcGVuIiwiYWN0dWFsQ2xvc2UiLCJlbWl0RHJhaW4iLCJidWYiLCJjbG9zZSIsIm9uY2UiLCJmbHVzaCIsInRyYWNlIiwiZGVidWciLCJpbmZvIiwid2FybiIsImVycm9yIiwiZmF0YWwiLCJsZXZlbE1ldGhvZHMiLCJudW1zIiwicmVkdWNlIiwiaW5pdGlhbExzQ2FjaGUiLCJpc1N0YW5kYXJkTGV2ZWwiLCJ1c2VPbmx5Q3VzdG9tTGV2ZWxzIiwiZ2VuTHNDYWNoZSIsImxldmVsTmFtZSIsImxhYmVscyIsImdldExldmVsIiwibGV2ZWxWYWwiLCJzZXRMZXZlbCIsInByZUxldmVsVmFsIiwidXNlT25seUN1c3RvbUxldmVsc1ZhbCIsImlzTGV2ZWxFbmFibGVkIiwibG9nTGV2ZWwiLCJsb2dMZXZlbFZhbCIsIm1hcHBpbmdzIiwiY3VzdG9tTGV2ZWxzIiwiY3VzdG9tTnVtcyIsIkluZmluaXR5Iiwic2lsZW50IiwiYXNzZXJ0Tm9MZXZlbENvbGxpc2lvbnMiLCJhc3NlcnREZWZhdWx0TGV2ZWxGb3VuZCIsImRlZmF1bHRMZXZlbCIsIm1hcCIsImluY2x1ZGVzIiwic3RhYmxlIiwiZGV0ZXJtaW5pc3RpY1N0cmluZ2lmeSIsInN0YWJsZVN0cmluZ2lmeSIsInJlcGxhY2VyU3RhY2siLCJyZXBsYWNlciIsInNwYWNlciIsImRlY2lyYyIsInZhbCIsInByb3BlcnR5RGVzY3JpcHRvciIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImNvbmZpZ3VyYWJsZSIsImlzQXJyYXkiLCJwb3AiLCJyZXBsYWNlR2V0dGVyVmFsdWVzIiwicGFydCIsImNvbXBhcmVGdW5jdGlvbiIsImEiLCJiIiwidG1wIiwiZGV0ZXJtaW5pc3RpY0RlY2lyYyIsInRvSlNPTiIsInNvcnQiLCJzcGxpY2UiLCJjc3NLZXl3b3JkcyIsInJldmVyc2VLZXl3b3JkcyIsImNvbnZlcnQiLCJyZ2IiLCJjaGFubmVscyIsImhzbCIsImhzdiIsImh3YiIsImNteWsiLCJ4eXoiLCJsYWIiLCJsY2giLCJoZXgiLCJrZXl3b3JkIiwiYW5zaTE2IiwiYW5zaTI1NiIsImhjZyIsImFwcGxlIiwiZ3JheSIsIm1vZGVsIiwiaCIsImciLCJtaW4iLCJNYXRoIiwibWF4IiwiZGVsdGEiLCJyZGlmIiwiZ2RpZiIsImJkaWYiLCJkaWZmIiwiZGlmZmMiLCJyZXZlcnNlZCIsImN1cnJlbnRDbG9zZXN0S2V5d29yZCIsIngiLCJ5IiwiY3VycmVudENsb3Nlc3REaXN0YW5jZSIsImRpc3RhbmNlIiwicG93IiwidDEiLCJ0MiIsInQzIiwic21pbiIsImxtaW4iLCJoaSIsImZsb29yIiwicSIsInNsIiwidm1pbiIsIndoIiwiYmwiLCJyYXRpbyIsInkyIiwieDIiLCJ6MiIsImF0YW4yIiwiUEkiLCJzcXJ0IiwiaHIiLCJjb3MiLCJzaW4iLCJhcmd1bWVudHMiLCJyb3VuZCIsImFuc2kiLCJtdWx0IiwicmVtIiwic3RyaW5nIiwic3Vic3RyaW5nIiwiY29sb3JTdHJpbmciLCJjaGFyIiwiaW50ZWdlciIsImh1ZSIsImNocm9tYSIsIm1nIiwicHVyZSIsInciLCJ2ZXJzaW9uIiwiTE9HX1ZFUlNJT04iLCJvcyIsInN0ZFNlcmlhbGl6ZXJzIiwicmVkYWN0aW9uIiwicHJvdG8iLCJzeW1ib2xzIiwiZXBvY2hUaW1lIiwibnVsbFRpbWUiLCJkZWZhdWx0RXJyb3JTZXJpYWxpemVyIiwidXNlTGV2ZWxMYWJlbHMiLCJiYXNlIiwidGltZXN0YW1wIiwiY2hhbmdlTGV2ZWxOYW1lIiwibm9ybWFsaXplIiwicGlubyIsImZvcm1hdE9wdHMiLCJjb3JlQ2hpbmRpbmdzIiwiRnVuY3Rpb24iLCJzZXRQcm90b3R5cGVPZiIsImV4dHJlbWUiLCJkZXN0aW5hdGlvbiIsInN0ZFRpbWVGdW5jdGlvbnMiLCJ0b2RheU5hbWUiLCJzZWVuIiwiX2VyciIsInBpbm9FcnJQcm90byIsInJhdyIsInJhd1N5bWJvbCIsInNldCIsInBpbm9SZXFQcm90byIsImlkIiwidXJsIiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJjb25uZWN0aW9uIiwiX3JlcSIsIm9yaWdpbmFsVXJsIiwicGlub1Jlc1Byb3RvIiwic3RhdHVzQ29kZSIsIl9yZXMiLCJnZXRIZWFkZXJzIiwiX2hlYWRlcnMiLCJmYXN0UmVkYWN0IiwicngiLCJ2YWxpZGF0b3IiLCJ2YWxpZGF0ZSIsIkVSUl9QQVRIU19NVVNUX0JFX1NUUklOR1MiLCJFUlJfSU5WQUxJRF9QQVRIIiwiQ0VOU09SIiwic3RyaWN0Iiwic2VyaWFsaXplIiwicGF0aHMiLCJyZW1vdmUiLCJoYW5kbGUiLCJzaGFwZSIsImxhc3RJbmRleCIsIm5leHQiLCJpbmRleCIsImxlYWRpbmdDaGFyIiwic3Vic3RyIiwic2VyaWFsaXplZENlbnNvciIsInRvcENlbnNvciIsInJlZGFjdG9yIiwicmVzdG9yZXIiLCJzdGF0ZSIsInJlc3RvcmUiLCJERUZBVUxUX0NFTlNPUiIsImZyb20iLCJTZXQiLCJ3aWxkY2FyZHMiLCJ3Y0xlbiIsInNlY3JldCIsImNvbXBpbGVSZXN0b3JlIiwiY3JlYXRlQ29udGV4dCIsInJ1bkluQ29udGV4dCIsImZvckVhY2giLCJwcm94eSIsImV4cHIiLCLjgIciLCJjb2RlR2VuZXJhdGlvbiIsInN0cmluZ3MiLCJ3YXNtIiwic3RyUGF0aCIsIml4IiwibGVhZGluZ0JyYWNrZXQiLCJzdGFyIiwiYmVmb3JlIiwiYmVmb3JlU3RyIiwiYWZ0ZXIiLCJuZXN0ZWQiLCJwcmVjZW5zb3JlZCIsImNpcmNsZSIsImVzY1BhdGgiLCJzdHJpY3RJbXBsIiwic2tpcCIsImRlbGltIiwiaG9wcyIsImV4aXN0ZW5jZSIsImNpcmN1bGFyRGV0ZWN0aW9uIiwicmV2ZXJzZSIsInJlZGFjdFRtcGwiLCJoYXNXaWxkY2FyZHMiLCJkeW5hbWljUmVkYWN0VG1wbCIsInJlc3VsdFRtcGwiLCJyZXNldHRlcnMiLCJyZXNldFRtcGwiLCJkeW5hbWljUmVzZXQiLCJyZXN0b3JlVG1wbCIsImJ1aWxkZXIiLCJ1bml4VGltZSIsImJrIiwiY2hpbGRMZXZlbCIsImx2bCIsInRyeVN0cmluZ2lmeSIsInNzIiwib2Zmc2V0Iiwib2JqZWN0cyIsImFyZ0xlbiIsImxhc3RQb3MiLCJmbGVuIiwiU3RyaW5nIiwiZXNjYXBlU3RyaW5nUmVnZXhwIiwiYW5zaVN0eWxlcyIsInN0ZG91dENvbG9yIiwidGVtcGxhdGUiLCJpc1NpbXBsZVdpbmRvd3NUZXJtIiwicGxhdGZvcm0iLCJlbnYiLCJURVJNIiwidG9Mb3dlckNhc2UiLCJsZXZlbE1hcHBpbmciLCJza2lwTW9kZWxzIiwic3R5bGVzIiwiYXBwbHlPcHRpb25zIiwic2NMZXZlbCIsIkNoYWxrIiwiY2hhbGtUYWciLCJjbG9zZVJlIiwiUmVnRXhwIiwiY29kZXMiLCJidWlsZCIsIl9zdHlsZXMiLCJfZW1wdHkiLCJ2aXNpYmxlIiwiaGFzIiwiYmdDb2xvciIsImRlZmluZVByb3BlcnRpZXMiLCJhcHBseVN0eWxlIiwic2VsZiIsImhhc0dyZXkiLCJfX3Byb3RvX18iLCJhcmdzTGVuIiwib3JpZ2luYWxEaW0iLCJkaW0iLCJwYXJ0cyIsIm1hdGNoT3BlcmF0b3JzUmUiLCJUeXBlRXJyb3IiLCJjb2xvckNvbnZlcnQiLCJ3cmFwQW5zaTE2IiwiZm4iLCJ3cmFwQW5zaTI1NiIsIndyYXBBbnNpMTZtIiwiTWFwIiwibW9kaWZpZXIiLCJyZXNldCIsImJvbGQiLCJpdGFsaWMiLCJ1bmRlcmxpbmUiLCJpbnZlcnNlIiwiaGlkZGVuIiwic3RyaWtldGhyb3VnaCIsImJsYWNrIiwibWFnZW50YSIsInJlZEJyaWdodCIsImdyZWVuQnJpZ2h0IiwieWVsbG93QnJpZ2h0IiwiYmx1ZUJyaWdodCIsIm1hZ2VudGFCcmlnaHQiLCJjeWFuQnJpZ2h0Iiwid2hpdGVCcmlnaHQiLCJiZ0JsYWNrIiwiYmdHcmVlbiIsImJnWWVsbG93IiwiYmdCbHVlIiwiYmdNYWdlbnRhIiwiYmdDeWFuIiwiYmdXaGl0ZSIsImJnQmxhY2tCcmlnaHQiLCJiZ1JlZEJyaWdodCIsImJnR3JlZW5CcmlnaHQiLCJiZ1llbGxvd0JyaWdodCIsImJnQmx1ZUJyaWdodCIsImJnTWFnZW50YUJyaWdodCIsImJnQ3lhbkJyaWdodCIsImJnV2hpdGVCcmlnaHQiLCJncm91cE5hbWUiLCJncm91cCIsInN0eWxlTmFtZSIsInN0eWxlIiwiYW5zaTJhbnNpIiwicmdiMnJnYiIsImFuc2kxNm0iLCJzdWl0ZSIsIndlYnBhY2tQb2x5ZmlsbCIsImRlcHJlY2F0ZSIsImNoaWxkcmVuIiwiY29udmVyc2lvbnMiLCJyb3V0ZSIsImZyb21Nb2RlbCIsInJvdXRlcyIsInRvTW9kZWwiLCJ3cmFwcGVkRm4iLCJjb252ZXJzaW9uIiwid3JhcFJvdW5kZWQiLCJ3cmFwUmF3IiwiZGVyaXZlQkZTIiwiZ3JhcGgiLCJtb2RlbHMiLCJidWlsZEdyYXBoIiwicXVldWUiLCJjdXJyZW50IiwiYWRqYWNlbnRzIiwiYWRqYWNlbnQiLCJub2RlIiwidW5zaGlmdCIsImxpbmsiLCJ0byIsIndyYXBDb252ZXJzaW9uIiwiY3VyIiwiaGFzRmxhZyIsImZvcmNlQ29sb3IiLCJnZXRTdXBwb3J0TGV2ZWwiLCJoYXNCYXNpYyIsImhhczI1NiIsImhhczE2bSIsInRyYW5zbGF0ZUxldmVsIiwiaXNUVFkiLCJvc1JlbGVhc2UiLCJ2ZXJzaW9ucyIsInNvbWUiLCJzaWduIiwiQ0lfTkFNRSIsIlRFQU1DSVRZX1ZFUlNJT04iLCJDT0xPUlRFUk0iLCJURVJNX1BST0dSQU1fVkVSU0lPTiIsIlRFUk1fUFJPR1JBTSIsIkZPUkNFX0NPTE9SIiwic3RkZXJyIiwiZmxhZyIsImFyZ3YiLCJwcmVmaXgiLCJwb3MiLCJ0ZXJtaW5hdG9yUG9zIiwiVEVNUExBVEVfUkVHRVgiLCJTVFlMRV9SRUdFWCIsIlNUUklOR19SRUdFWCIsIkVTQ0FQRV9SRUdFWCIsIkVTQ0FQRVMiLCJ1bmVzY2FwZSIsImZyb21DaGFyQ29kZSIsInBhcnNlQXJndW1lbnRzIiwicmVzdWx0cyIsImNodW5rcyIsInRyaW0iLCJpc05hTiIsImVzY2FwZSIsImNociIsInBhcnNlU3R5bGUiLCJidWlsZFN0eWxlIiwibGF5ZXIiLCJlc2NhcGVDaGFyIiwiZXJyTXNnIiwiZ2xvYmFsIiwidG9rZW4iLCJ0aW1lem9uZSIsInRpbWV6b25lQ2xpcCIsImRhdGVGb3JtYXQiLCJtYXNrIiwidXRjIiwiZ210Iiwia2luZE9mIiwibWFza1NsaWNlIiwibWFza3MiLCJEIiwiSCIsIk0iLCJMIiwiZ2V0VGltZXpvbmVPZmZzZXQiLCJXIiwiZ2V0V2VlayIsIk4iLCJnZXREYXlPZldlZWsiLCJmbGFncyIsImRkIiwicGFkIiwiZGRkIiwiaTE4biIsImRheU5hbWVzIiwiZGRkZCIsIm1tIiwibW1tIiwibW9udGhOYW1lcyIsIm1tbW0iLCJ5eSIsInl5eXkiLCJoaCIsIkhIIiwiTU0iLCJ0aW1lTmFtZXMiLCJ0dCIsIlQiLCJUVCIsIloiLCJhYnMiLCJTIiwidGFyZ2V0VGh1cnNkYXkiLCJnZXRGdWxsWWVhciIsImdldE1vbnRoIiwiZ2V0RGF0ZSIsInNldERhdGUiLCJmaXJzdFRodXJzZGF5IiwiZHMiLCJzZXRIb3VycyIsImdldEhvdXJzIiwid2Vla0RpZmYiLCJkb3ciLCJQYXJzZSIsImlzT2JqZWN0Iiwic3RyaWN0RGVlcEVxdWFsIiwiZmlyc3QiLCJzZWNvbmQiLCJrZXlzU2VlbiIsImtleTIiLCJpc0ZhbHNlIiwidHJpbUxlZnQiLCJUWVBFX05VTUJFUiIsIlRZUEVfQU5ZIiwiVFlQRV9TVFJJTkciLCJUWVBFX0FSUkFZIiwiVFlQRV9PQkpFQ1QiLCJUWVBFX0VYUFJFRiIsIlRZUEVfQVJSQVlfTlVNQkVSIiwiVFlQRV9BUlJBWV9TVFJJTkciLCJiYXNpY1Rva2VucyIsIm9wZXJhdG9yU3RhcnRUb2tlbiIsInNraXBDaGFycyIsImlzTnVtIiwiY2giLCJMZXhlciIsInRva2VuaXplIiwic3RhcnQiLCJpZGVudGlmaWVyIiwidG9rZW5zIiwiX2N1cnJlbnQiLCJfY29uc3VtZVVucXVvdGVkSWRlbnRpZmllciIsIl9jb25zdW1lTnVtYmVyIiwiX2NvbnN1bWVMQnJhY2tldCIsIl9jb25zdW1lUXVvdGVkSWRlbnRpZmllciIsIl9jb25zdW1lUmF3U3RyaW5nTGl0ZXJhbCIsImxpdGVyYWwiLCJfY29uc3VtZUxpdGVyYWwiLCJfY29uc3VtZU9wZXJhdG9yIiwibWF4TGVuZ3RoIiwic3RhcnRpbmdDaGFyIiwibGl0ZXJhbFN0cmluZyIsIl9sb29rc0xpa2VKU09OIiwiZXgiLCJiaW5kaW5nUG93ZXIiLCJQYXJzZXIiLCJUcmVlSW50ZXJwcmV0ZXIiLCJydW50aW1lIiwiUnVudGltZSIsImludGVycHJldGVyIiwiX2ludGVycHJldGVyIiwiZnVuY3Rpb25UYWJsZSIsIl9mdW5jIiwiX2Z1bmN0aW9uQWJzIiwiX3NpZ25hdHVyZSIsInR5cGVzIiwiYXZnIiwiX2Z1bmN0aW9uQXZnIiwiY2VpbCIsIl9mdW5jdGlvbkNlaWwiLCJjb250YWlucyIsIl9mdW5jdGlvbkNvbnRhaW5zIiwiX2Z1bmN0aW9uRW5kc1dpdGgiLCJfZnVuY3Rpb25GbG9vciIsIl9mdW5jdGlvbkxlbmd0aCIsIl9mdW5jdGlvbk1hcCIsIl9mdW5jdGlvbk1heCIsIl9mdW5jdGlvbk1lcmdlIiwidmFyaWFkaWMiLCJfZnVuY3Rpb25NYXhCeSIsInN1bSIsIl9mdW5jdGlvblN1bSIsIl9mdW5jdGlvblN0YXJ0c1dpdGgiLCJfZnVuY3Rpb25NaW4iLCJfZnVuY3Rpb25NaW5CeSIsIl9mdW5jdGlvblR5cGUiLCJfZnVuY3Rpb25LZXlzIiwiX2Z1bmN0aW9uVmFsdWVzIiwiX2Z1bmN0aW9uU29ydCIsIl9mdW5jdGlvblNvcnRCeSIsIl9mdW5jdGlvbkpvaW4iLCJfZnVuY3Rpb25SZXZlcnNlIiwiX2Z1bmN0aW9uVG9BcnJheSIsIl9mdW5jdGlvblRvU3RyaW5nIiwiX2Z1bmN0aW9uVG9OdW1iZXIiLCJfZnVuY3Rpb25Ob3ROdWxsIiwiZXhwcmVzc2lvbiIsIl9sb2FkVG9rZW5zIiwiYXN0IiwiX2xvb2thaGVhZCIsIl9sb29rYWhlYWRUb2tlbiIsInJicCIsImxlZnRUb2tlbiIsIl9hZHZhbmNlIiwibGVmdCIsIm51ZCIsImN1cnJlbnRUb2tlbiIsImxlZCIsIm51bWJlciIsInJpZ2h0IiwiTm90IiwiX3BhcnNlUHJvamVjdGlvblJIUyIsIlN0YXIiLCJfcGFyc2VNdWx0aXNlbGVjdEhhc2giLCJGbGF0dGVuIiwiX3BhcnNlSW5kZXhFeHByZXNzaW9uIiwiX3Byb2plY3RJZlNsaWNlIiwiX3BhcnNlTXVsdGlzZWxlY3RMaXN0IiwiRXhwcmVmIiwiX21hdGNoIiwiX2Vycm9yVG9rZW4iLCJ0b2tlbk5hbWUiLCJEb3QiLCJfcGFyc2VEb3RSSFMiLCJQaXBlIiwiT3IiLCJBbmQiLCJjb25kaXRpb24iLCJGaWx0ZXIiLCJfcGFyc2VDb21wYXJhdG9yIiwidG9rZW5UeXBlIiwiX3BhcnNlU2xpY2VFeHByZXNzaW9uIiwiaW5kZXhFeHByIiwiY29tcGFyYXRvciIsImxvb2thaGVhZCIsImV4cHJlc3Npb25zIiwia2V5VG9rZW4iLCJrZXlOYW1lIiwicGFpcnMiLCJpZGVudGlmaWVyVHlwZXMiLCJ2aXNpdCIsIm1hdGNoZWQiLCJmaWVsZCIsImNvbGxlY3RlZCIsInNsaWNlUGFyYW1zIiwiY29tcHV0ZWQiLCJjb21wdXRlU2xpY2VQYXJhbXMiLCJzdG9wIiwic3RlcCIsIm9ialZhbHVlcyIsImZpbHRlcmVkIiwiZmluYWxSZXN1bHRzIiwib3JpZ2luYWwiLCJtZXJnZWQiLCJyZXNvbHZlZEFyZ3MiLCJjYWxsRnVuY3Rpb24iLCJyZWZOb2RlIiwiam1lc3BhdGhUeXBlIiwiYXJyYXlMZW5ndGgiLCJzdGVwVmFsdWVOZWdhdGl2ZSIsImNhcFNsaWNlUmFuZ2UiLCJhY3R1YWxWYWx1ZSIsImZ1bmN0aW9uRW50cnkiLCJfdmFsaWRhdGVBcmdzIiwic2lnbmF0dXJlIiwicGx1cmFsaXplZCIsImN1cnJlbnRTcGVjIiwiYWN0dWFsVHlwZSIsInR5cGVNYXRjaGVkIiwiX2dldFR5cGVOYW1lIiwiX3R5cGVNYXRjaGVzIiwiYWN0dWFsIiwiZXhwZWN0ZWQiLCJhcmdWYWx1ZSIsInN1YnR5cGUiLCJsYXN0SW5kZXhPZiIsInNlYXJjaFN0ciIsInN1ZmZpeCIsIm9yaWdpbmFsU3RyIiwicmV2ZXJzZWRTdHIiLCJyZXZlcnNlZEFycmF5IiwiaW5wdXRBcnJheSIsIm1hcHBlZCIsImV4cHJlZk5vZGUiLCJlbGVtZW50cyIsIm1heEVsZW1lbnQiLCJsb2NhbGVDb21wYXJlIiwibWluRWxlbWVudCIsImxpc3RUb1N1bSIsImpvaW5DaGFyIiwiY29udmVydGVkVmFsdWUiLCJ0eXBlTmFtZSIsInNvcnRlZEFycmF5IiwicmVxdWlyZWRUeXBlIiwidGhhdCIsImRlY29yYXRlZCIsImV4cHJBIiwiZXhwckIiLCJtYXhSZWNvcmQiLCJyZXNvbHZlZEFycmF5Iiwia2V5RnVuY3Rpb24iLCJjcmVhdGVLZXlGdW5jdGlvbiIsIm1heE51bWJlciIsIm1pblJlY29yZCIsIm1pbk51bWJlciIsImFsbG93ZWRUeXBlcyIsImNvbXBpbGUiLCJwYXJzZXIiLCJjb25maWciLCJMT0dHRVJfTEVWRUwiLCJPUkRFUkVEX0RBWVNfT0ZfV0VFSyIsInRpbWVTZXJ2aWNlIiwiZGF5IiwiYWRkTnVtYmVycyIsIm51bWJlcnMiLCJhY2N1bXVsYXRvciJdLCJtYXBwaW5ncyI6IjREQUNFLElBQUlBLEVBQW1CLEdBR3ZCLFNBQVNDLEVBQW9CQyxHQUc1QixHQUFHRixFQUFpQkUsR0FDbkIsT0FBT0YsRUFBaUJFLEdBQVVDLFFBR25DLElBQUlDLEVBQVNKLEVBQWlCRSxHQUFZLENBQ3pDRyxFQUFHSCxFQUNI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LElBQUkyckIsR0FDQTdzQixNQUFNa0IsSUF1QnpCcEgsRUFBUWtOLE9BZFIsU0FBZ0JqRixFQUFNdXRCLEdBQ2xCLElBQUkrRyxFQUFTLElBQUl4SixFQUliRSxFQUFVLElBQUlDLEVBQ2RDLEVBQWMsSUFBSUgsRUFBZ0JDLEdBQ3RDQSxFQUFRRyxhQUFlRCxFQUN2QixJQUFJckosRUFBT3lTLEVBQU9yMkIsTUFBTXN2QixHQUN4QixPQUFPckMsRUFBWWptQixPQUFPNGMsRUFBTTdoQixJQU1wQ2pJLEVBQVF1d0IsZ0JBQWtCQSxFQWpvRDVCLENBa29EeUR2d0IsSSw2QkNob0R6REMsRUFBT0QsUUFBVSxDQUNmNk4sWUFBYSwwQkFDYi9CLFlBQWEsUSxzZ0dDTWYsTUFBTTB3QixFQUFTLENBQ2IvN0IsS0FBTSw0QkFDTmtGLE1BQU82RCxRQUFRc2EsSUFBSTJZLGNBQWdCLFFBQ25DbnpCLFlBQWEsQ0FDWHVDLFlBQVksR0FFZGpILFdBQUEsS0FLYSxNQUZBLElBQUs0M0IsR0NuQnBCLHFGQWFBLE1BQU1FLEVBQXVCLENBQ3pCLFNBQ0EsU0FDQSxVQUNBLFlBQ0EsV0FDQSxTQUNBLFlBR0csU0FBU3JmLEVBQVVzZixFQUFjLFFBQ3BDLE1BQU1DLEVBQU1ELEVBQVlqeUIsbUJBQ3hCLE9BQU9neUIsRUFBcUJFLEdBR3pCLFNBQVNDLEtBQWNDLEdBRTFCLE9BREEsRUFBT2pwQixLQUFLLHFCQUFxQixrQkFBUWlwQixNQUNsQzN0QixNQUFNK1EsS0FBSzRjLEdBQVMzb0IsT0FBTyxDQUFDNG9CLEVBQWEzRyxJQUFXMkcsRUFBYzNHLEVBQVEiLCJmaWxlIjoibWFpbi5taW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyIgXHQvLyBUaGUgbW9kdWxlIGNhY2hlXG4gXHR2YXIgaW5zdGFsbGVkTW9kdWxlcyA9IHt9O1xuXG4gXHQvLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuIFx0ZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXG4gXHRcdC8vIENoZWNrIGlmIG1vZHVsZSBpcyBpbiBjYWNoZVxuIFx0XHRpZihpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXSkge1xuIFx0XHRcdHJldHVybiBpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXS5leHBvcnRzO1xuIFx0XHR9XG4gXHRcdC8vIENyZWF0ZSBhIG5ldyBtb2R1bGUgKGFuZCBwdXQgaXQgaW50byB0aGUgY2FjaGUpXG4gXHRcdHZhciBtb2R1bGUgPSBpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXSA9IHtcbiBcdFx0XHRpOiBtb2R1bGVJZCxcbiBcdFx0XHRsOiBmYWxzZSxcbiBcdFx0XHRleHBvcnRzOiB7fVxuIFx0XHR9O1xuXG4gXHRcdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuIFx0XHRtb2R1bGVzW21vZHVsZUlkXS5jYWxsKG1vZHVsZS5leHBvcnRzLCBtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuIFx0XHQvLyBGbGFnIHRoZSBtb2R1bGUgYXMgbG9hZGVkXG4gXHRcdG1vZHVsZS5sID0gdHJ1ZTtcblxuIFx0XHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuIFx0XHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG4gXHR9XG5cblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGVzIG9iamVjdCAoX193ZWJwYWNrX21vZHVsZXNfXylcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubSA9IG1vZHVsZXM7XG5cbiBcdC8vIGV4cG9zZSB0aGUgbW9kdWxlIGNhY2hlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLmMgPSBpbnN0YWxsZWRNb2R1bGVzO1xuXG4gXHQvLyBkZWZpbmUgZ2V0dGVyIGZ1bmN0aW9uIGZvciBoYXJtb255IGV4cG9ydHNcbiBcdF9fd2VicGFja19yZXF1aXJlX18uZCA9IGZ1bmN0aW9uKGV4cG9ydHMsIG5hbWUsIGdldHRlcikge1xuIFx0XHRpZighX193ZWJwYWNrX3JlcXVpcmVfXy5vKGV4cG9ydHMsIG5hbWUpKSB7XG4gXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIG5hbWUsIHsgZW51bWVyYWJsZTogdHJ1ZSwgZ2V0OiBnZXR0ZXIgfSk7XG4gXHRcdH1cbiBcdH07XG5cbiBcdC8vIGRlZmluZSBfX2VzTW9kdWxlIG9uIGV4cG9ydHNcbiBcdF9fd2VicGFja19yZXF1aXJlX18uciA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiBcdFx0aWYodHlwZW9mIFN5bWJvbCAhPT0gJ3VuZGVmaW5lZCcgJiYgU3ltYm9sLnRvU3RyaW5nVGFnKSB7XG4gXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFN5bWJvbC50b1N0cmluZ1RhZywgeyB2YWx1ZTogJ01vZHVsZScgfSk7XG4gXHRcdH1cbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsICdfX2VzTW9kdWxlJywgeyB2YWx1ZTogdHJ1ZSB9KTtcbiBcdH07XG5cbiBcdC8vIGNyZWF0ZSBhIGZha2UgbmFtZXNwYWNlIG9iamVjdFxuIFx0Ly8gbW9kZSAmIDE6IHZhbHVlIGlzIGEgbW9kdWxlIGlkLCByZXF1aXJlIGl0XG4gXHQvLyBtb2RlICYgMjogbWVyZ2UgYWxsIHByb3BlcnRpZXMgb2YgdmFsdWUgaW50byB0aGUgbnNcbiBcdC8vIG1vZGUgJiA0OiByZXR1cm4gdmFsdWUgd2hlbiBhbHJlYWR5IG5zIG9iamVjdFxuIFx0Ly8gbW9kZSAmIDh8MTogYmVoYXZlIGxpa2UgcmVxdWlyZVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy50ID0gZnVuY3Rpb24odmFsdWUsIG1vZGUpIHtcbiBcdFx0aWYobW9kZSAmIDEpIHZhbHVlID0gX193ZWJwYWNrX3JlcXVpcmVfXyh2YWx1ZSk7XG4gXHRcdGlmKG1vZGUgJiA4KSByZXR1cm4gdmFsdWU7XG4gXHRcdGlmKChtb2RlICYgNCkgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAmJiB2YWx1ZS5fX2VzTW9kdWxlKSByZXR1cm4gdmFsdWU7XG4gXHRcdHZhciBucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gXHRcdF9fd2VicGFja19yZXF1aXJlX18ucihucyk7XG4gXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShucywgJ2RlZmF1bHQnLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2YWx1ZSB9KTtcbiBcdFx0aWYobW9kZSAmIDIgJiYgdHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSBmb3IodmFyIGtleSBpbiB2YWx1ZSkgX193ZWJwYWNrX3JlcXVpcmVfXy5kKG5zLCBrZXksIGZ1bmN0aW9uKGtleSkgeyByZXR1cm4gdmFsdWVba2V5XTsgfS5iaW5kKG51bGwsIGtleSkpO1xuIFx0XHRyZXR1cm4gbnM7XG4gXHR9O1xuXG4gXHQvLyBnZXREZWZhdWx0RXhwb3J0IGZ1bmN0aW9uIGZvciBjb21wYXRpYmlsaXR5IHdpdGggbm9uLWhhcm1vbnkgbW9kdWxlc1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5uID0gZnVuY3Rpb24obW9kdWxlKSB7XG4gXHRcdHZhciBnZXR0ZXIgPSBtb2R1bGUgJiYgbW9kdWxlLl9fZXNNb2R1bGUgP1xuIFx0XHRcdGZ1bmN0aW9uIGdldERlZmF1bHQoKSB7IHJldHVybiBtb2R1bGVbJ2RlZmF1bHQnXTsgfSA6XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0TW9kdWxlRXhwb3J0cygpIHsgcmV0dXJuIG1vZHVsZTsgfTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kKGdldHRlciwgJ2EnLCBnZXR0ZXIpO1xuIFx0XHRyZXR1cm4gZ2V0dGVyO1xuIFx0fTtcblxuIFx0Ly8gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm8gPSBmdW5jdGlvbihvYmplY3QsIHByb3BlcnR5KSB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBwcm9wZXJ0eSk7IH07XG5cbiBcdC8vIF9fd2VicGFja19wdWJsaWNfcGF0aF9fXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnAgPSBcIlwiO1xuXG5cbiBcdC8vIExvYWQgZW50cnkgbW9kdWxlIGFuZCByZXR1cm4gZXhwb3J0c1xuIFx0cmV0dXJuIF9fd2VicGFja19yZXF1aXJlX18oX193ZWJwYWNrX3JlcXVpcmVfXy5zID0gMTcpO1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IHNldExldmVsU3ltID0gU3ltYm9sKCdwaW5vLnNldExldmVsJylcbmNvbnN0IGdldExldmVsU3ltID0gU3ltYm9sKCdwaW5vLmdldExldmVsJylcbmNvbnN0IGxldmVsVmFsU3ltID0gU3ltYm9sKCdwaW5vLmxldmVsVmFsJylcbmNvbnN0IHVzZUxldmVsTGFiZWxzU3ltID0gU3ltYm9sKCdwaW5vLnVzZUxldmVsTGFiZWxzJylcbmNvbnN0IGNoYW5nZUxldmVsTmFtZVN5bSA9IFN5bWJvbCgncGluby5jaGFuZ2VMZXZlbE5hbWUnKVxuY29uc3QgdXNlT25seUN1c3RvbUxldmVsc1N5bSA9IFN5bWJvbCgncGluby51c2VPbmx5Q3VzdG9tTGV2ZWxzJylcblxuY29uc3QgbHNDYWNoZVN5bSA9IFN5bWJvbCgncGluby5sc0NhY2hlJylcbmNvbnN0IGNoaW5kaW5nc1N5bSA9IFN5bWJvbCgncGluby5jaGluZGluZ3MnKVxuY29uc3QgcGFyc2VkQ2hpbmRpbmdzU3ltID0gU3ltYm9sKCdwaW5vLnBhcnNlZENoaW5kaW5ncycpXG5cbmNvbnN0IGFzSnNvblN5bSA9IFN5bWJvbCgncGluby5hc0pzb24nKVxuY29uc3Qgd3JpdGVTeW0gPSBTeW1ib2woJ3Bpbm8ud3JpdGUnKVxuY29uc3QgcmVkYWN0Rm10U3ltID0gU3ltYm9sKCdwaW5vLnJlZGFjdEZtdCcpXG5cbmNvbnN0IHRpbWVTeW0gPSBTeW1ib2woJ3Bpbm8udGltZScpXG5jb25zdCBzdHJlYW1TeW0gPSBTeW1ib2woJ3Bpbm8uc3RyZWFtJylcbmNvbnN0IHN0cmluZ2lmeVN5bSA9IFN5bWJvbCgncGluby5zdHJpbmdpZnknKVxuY29uc3Qgc3RyaW5naWZpZXJzU3ltID0gU3ltYm9sKCdwaW5vLnN0cmluZ2lmaWVycycpXG5jb25zdCBlbmRTeW0gPSBTeW1ib2woJ3Bpbm8uZW5kJylcbmNvbnN0IGZvcm1hdE9wdHNTeW0gPSBTeW1ib2woJ3Bpbm8uZm9ybWF0T3B0cycpXG5jb25zdCBtZXNzYWdlS2V5U3RyaW5nU3ltID0gU3ltYm9sKCdwaW5vLm1lc3NhZ2VLZXlTdHJpbmcnKVxuXG4vLyBwdWJsaWMgc3ltYm9scywgbm8gbmVlZCB0byB1c2UgdGhlIHNhbWUgcGlub1xuLy8gdmVyc2lvbiBmb3IgdGhlc2VcbmNvbnN0IHNlcmlhbGl6ZXJzU3ltID0gU3ltYm9sLmZvcigncGluby5zZXJpYWxpemVycycpXG5jb25zdCB3aWxkY2FyZEdzeW0gPSBTeW1ib2wuZm9yKCdwaW5vLionKVxuY29uc3QgbmVlZHNNZXRhZGF0YUdzeW0gPSBTeW1ib2wuZm9yKCdwaW5vLm1ldGFkYXRhJylcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNldExldmVsU3ltLFxuICBnZXRMZXZlbFN5bSxcbiAgbGV2ZWxWYWxTeW0sXG4gIHVzZUxldmVsTGFiZWxzU3ltLFxuICBsc0NhY2hlU3ltLFxuICBjaGluZGluZ3NTeW0sXG4gIHBhcnNlZENoaW5kaW5nc1N5bSxcbiAgYXNKc29uU3ltLFxuICB3cml0ZVN5bSxcbiAgc2VyaWFsaXplcnNTeW0sXG4gIHJlZGFjdEZtdFN5bSxcbiAgdGltZVN5bSxcbiAgc3RyZWFtU3ltLFxuICBzdHJpbmdpZnlTeW0sXG4gIHN0cmluZ2lmaWVyc1N5bSxcbiAgZW5kU3ltLFxuICBmb3JtYXRPcHRzU3ltLFxuICBtZXNzYWdlS2V5U3RyaW5nU3ltLFxuICBjaGFuZ2VMZXZlbE5hbWVTeW0sXG4gIHdpbGRjYXJkR3N5bSxcbiAgbmVlZHNNZXRhZGF0YUdzeW0sXG4gIHVzZU9ubHlDdXN0b21MZXZlbHNTeW1cbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IC9bXi5bXFxdXSt8XFxbKD86KC0/XFxkKyg/OlxcLlxcZCspPykoKD86KD8hXFwyKVteXFxcXF18XFxcXC4pKj8pXFwyKVxcXXwoPz0oXFwufFxcW1xcXSkoPzpcXDR8JCkpJC9nXG4iLCIndXNlIHN0cmljdCdcblxuLy8gWW91IG1heSBiZSB0ZW1wdGVkIHRvIGNvcHkgYW5kIHBhc3RlIHRoaXMsIFxuLy8gYnV0IHRha2UgYSBsb29rIGF0IHRoZSBjb21taXQgaGlzdG9yeSBmaXJzdCxcbi8vIHRoaXMgaXMgYSBtb3ZpbmcgdGFyZ2V0IHNvIHJlbHlpbmcgb24gdGhlIG1vZHVsZVxuLy8gaXMgdGhlIGJlc3Qgd2F5IHRvIG1ha2Ugc3VyZSB0aGUgb3B0aW1pemF0aW9uXG4vLyBtZXRob2QgaXMga2VwdCB1cCB0byBkYXRlIGFuZCBjb21wYXRpYmxlIHdpdGhcbi8vIGV2ZXJ5IE5vZGUgdmVyc2lvbi5cblxuZnVuY3Rpb24gZmxhdHN0ciAocykge1xuICBzIHwgMFxuICByZXR1cm4gc1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZsYXRzdHIiLCIndXNlIHN0cmljdCdcblxuY29uc3QgZm9ybWF0ID0gcmVxdWlyZSgncXVpY2stZm9ybWF0LXVuZXNjYXBlZCcpXG5jb25zdCB7IG1hcEh0dHBSZXF1ZXN0LCBtYXBIdHRwUmVzcG9uc2UgfSA9IHJlcXVpcmUoJ3Bpbm8tc3RkLXNlcmlhbGl6ZXJzJylcbmNvbnN0IFNvbmljQm9vbSA9IHJlcXVpcmUoJ3NvbmljLWJvb20nKVxuY29uc3Qgc3RyaW5naWZ5U2FmZSA9IHJlcXVpcmUoJ2Zhc3Qtc2FmZS1zdHJpbmdpZnknKVxuY29uc3Qge1xuICBsc0NhY2hlU3ltLFxuICBjaGluZGluZ3NTeW0sXG4gIHBhcnNlZENoaW5kaW5nc1N5bSxcbiAgd3JpdGVTeW0sXG4gIG1lc3NhZ2VLZXlTdHJpbmdTeW0sXG4gIHNlcmlhbGl6ZXJzU3ltLFxuICBmb3JtYXRPcHRzU3ltLFxuICBlbmRTeW0sXG4gIHN0cmluZ2lmaWVyc1N5bSxcbiAgc3RyaW5naWZ5U3ltLFxuICBuZWVkc01ldGFkYXRhR3N5bSxcbiAgd2lsZGNhcmRHc3ltLFxuICByZWRhY3RGbXRTeW0sXG4gIHN0cmVhbVN5bVxufSA9IHJlcXVpcmUoJy4vc3ltYm9scycpXG5cbmZ1bmN0aW9uIG5vb3AgKCkge31cblxuZnVuY3Rpb24gZ2VuTG9nICh6KSB7XG4gIHJldHVybiBmdW5jdGlvbiBMT0cgKG8sIC4uLm4pIHtcbiAgICBpZiAodHlwZW9mIG8gPT09ICdvYmplY3QnICYmIG8gIT09IG51bGwpIHtcbiAgICAgIGlmIChvLm1ldGhvZCAmJiBvLmhlYWRlcnMgJiYgby5zb2NrZXQpIHtcbiAgICAgICAgbyA9IG1hcEh0dHBSZXF1ZXN0KG8pXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBvLnNldEhlYWRlciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBvID0gbWFwSHR0cFJlc3BvbnNlKG8pXG4gICAgICB9XG4gICAgICB0aGlzW3dyaXRlU3ltXShvLCBmb3JtYXQobnVsbCwgbiwgdGhpc1tmb3JtYXRPcHRzU3ltXSksIHopXG4gICAgfSBlbHNlIHRoaXNbd3JpdGVTeW1dKG51bGwsIGZvcm1hdChvLCBuLCB0aGlzW2Zvcm1hdE9wdHNTeW1dKSwgeilcbiAgfVxufVxuXG4vLyBtYWdpY2FsbHkgZXNjYXBlIHN0cmluZ3MgZm9yIGpzb25cbi8vIHJlbHlpbmcgb24gdGhlaXIgY2hhckNvZGVBdFxuLy8gZXZlcnl0aGluZyBiZWxvdyAzMiBuZWVkcyBKU09OLnN0cmluZ2lmeSgpXG4vLyAzNCBhbmQgOTIgaGFwcGVucyBhbGwgdGhlIHRpbWUsIHNvIHdlXG4vLyBoYXZlIGEgZmFzdCBjYXNlIGZvciB0aGVtXG5mdW5jdGlvbiBhc1N0cmluZyAoc3RyKSB7XG4gIHZhciByZXN1bHQgPSAnJ1xuICB2YXIgbGFzdCA9IDBcbiAgdmFyIGZvdW5kID0gZmFsc2VcbiAgdmFyIHBvaW50ID0gMjU1XG4gIGNvbnN0IGwgPSBzdHIubGVuZ3RoXG4gIGlmIChsID4gMTAwKSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHN0cilcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGwgJiYgcG9pbnQgPj0gMzI7IGkrKykge1xuICAgIHBvaW50ID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBpZiAocG9pbnQgPT09IDM0IHx8IHBvaW50ID09PSA5Mikge1xuICAgICAgcmVzdWx0ICs9IHN0ci5zbGljZShsYXN0LCBpKSArICdcXFxcJ1xuICAgICAgbGFzdCA9IGlcbiAgICAgIGZvdW5kID0gdHJ1ZVxuICAgIH1cbiAgfVxuICBpZiAoIWZvdW5kKSB7XG4gICAgcmVzdWx0ID0gc3RyXG4gIH0gZWxzZSB7XG4gICAgcmVzdWx0ICs9IHN0ci5zbGljZShsYXN0KVxuICB9XG4gIHJldHVybiBwb2ludCA8IDMyID8gSlNPTi5zdHJpbmdpZnkoc3RyKSA6ICdcIicgKyByZXN1bHQgKyAnXCInXG59XG5cbmZ1bmN0aW9uIGFzSnNvbiAob2JqLCBtc2csIG51bSwgdGltZSkge1xuICAvLyB0byBjYXRjaCBib3RoIG51bGwgYW5kIHVuZGVmaW5lZFxuICBjb25zdCBoYXNPYmogPSBvYmogIT09IHVuZGVmaW5lZCAmJiBvYmogIT09IG51bGxcbiAgY29uc3Qgb2JqRXJyb3IgPSBoYXNPYmogJiYgb2JqIGluc3RhbmNlb2YgRXJyb3JcbiAgbXNnID0gIW1zZyAmJiBvYmpFcnJvciA9PT0gdHJ1ZSA/IG9iai5tZXNzYWdlIDogbXNnIHx8IHVuZGVmaW5lZFxuICBjb25zdCBzdHJpbmdpZnkgPSB0aGlzW3N0cmluZ2lmeVN5bV1cbiAgY29uc3Qgc3RyaW5naWZpZXJzID0gdGhpc1tzdHJpbmdpZmllcnNTeW1dXG4gIGNvbnN0IGVuZCA9IHRoaXNbZW5kU3ltXVxuICBjb25zdCBtZXNzYWdlS2V5U3RyaW5nID0gdGhpc1ttZXNzYWdlS2V5U3RyaW5nU3ltXVxuICBjb25zdCBjaGluZGluZ3MgPSB0aGlzW2NoaW5kaW5nc1N5bV1cbiAgY29uc3Qgc2VyaWFsaXplcnMgPSB0aGlzW3NlcmlhbGl6ZXJzU3ltXVxuICB2YXIgZGF0YSA9IHRoaXNbbHNDYWNoZVN5bV1bbnVtXSArIHRpbWVcbiAgaWYgKG1zZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZGF0YSArPSBtZXNzYWdlS2V5U3RyaW5nICsgYXNTdHJpbmcoJycgKyBtc2cpXG4gIH1cbiAgLy8gd2UgbmVlZCB0aGUgY2hpbGQgYmluZGluZ3MgYWRkZWQgdG8gdGhlIG91dHB1dCBmaXJzdCBzbyBpbnN0YW5jZSBsb2dnZWRcbiAgLy8gb2JqZWN0cyBjYW4gdGFrZSBwcmVjZWRlbmNlIHdoZW4gSlNPTi5wYXJzZS1pbmcgdGhlIHJlc3VsdGluZyBsb2cgbGluZVxuICBkYXRhID0gZGF0YSArIGNoaW5kaW5nc1xuICB2YXIgdmFsdWVcbiAgaWYgKGhhc09iaiA9PT0gdHJ1ZSkge1xuICAgIHZhciBub3RIYXNPd25Qcm9wZXJ0eSA9IG9iai5oYXNPd25Qcm9wZXJ0eSA9PT0gdW5kZWZpbmVkXG4gICAgaWYgKG9iakVycm9yID09PSB0cnVlKSB7XG4gICAgICBkYXRhICs9ICcsXCJ0eXBlXCI6XCJFcnJvclwiJ1xuICAgICAgaWYgKG9iai5zdGFjayAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRhdGEgKz0gJyxcInN0YWNrXCI6JyArIHN0cmluZ2lmeShvYmouc3RhY2spXG4gICAgICB9XG4gICAgfVxuICAgIC8vIGlmIGdsb2JhbCBzZXJpYWxpemVyIGlzIHNldCwgY2FsbCBpdCBmaXJzdFxuICAgIGlmIChzZXJpYWxpemVyc1t3aWxkY2FyZEdzeW1dKSB7XG4gICAgICBvYmogPSBzZXJpYWxpemVyc1t3aWxkY2FyZEdzeW1dKG9iailcbiAgICB9XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgdmFsdWUgPSBvYmpba2V5XVxuICAgICAgaWYgKChub3RIYXNPd25Qcm9wZXJ0eSB8fCBvYmouaGFzT3duUHJvcGVydHkoa2V5KSkgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB2YWx1ZSA9IHNlcmlhbGl6ZXJzW2tleV0gPyBzZXJpYWxpemVyc1trZXldKHZhbHVlKSA6IHZhbHVlXG5cbiAgICAgICAgc3dpdGNoICh0eXBlb2YgdmFsdWUpIHtcbiAgICAgICAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgICAgICAgIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgICAgICAgIC8qIGVzbGludCBuby1mYWxsdGhyb3VnaDogXCJvZmZcIiAqL1xuICAgICAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gdGhpcyBjYXNlIGV4cGxpY2l0eSBmYWxscyB0aHJvdWdoIHRvIHRoZSBuZXh0IG9uZVxuICAgICAgICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgICAgICAgaWYgKHN0cmluZ2lmaWVyc1trZXldKSB2YWx1ZSA9IHN0cmluZ2lmaWVyc1trZXldKHZhbHVlKVxuICAgICAgICAgICAgZGF0YSArPSAnLFwiJyArIGtleSArICdcIjonICsgdmFsdWVcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgICAgICAgIHZhbHVlID0gKHN0cmluZ2lmaWVyc1trZXldIHx8IGFzU3RyaW5nKSh2YWx1ZSlcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHZhbHVlID0gKHN0cmluZ2lmaWVyc1trZXldIHx8IHN0cmluZ2lmeSkodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG4gICAgICAgIGRhdGEgKz0gJyxcIicgKyBrZXkgKyAnXCI6JyArIHZhbHVlXG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBkYXRhICsgZW5kXG59XG5cbmZ1bmN0aW9uIGFzQ2hpbmRpbmdzIChpbnN0YW5jZSwgYmluZGluZ3MpIHtcbiAgaWYgKCFiaW5kaW5ncykge1xuICAgIHRocm93IEVycm9yKCdtaXNzaW5nIGJpbmRpbmdzIGZvciBjaGlsZCBQaW5vJylcbiAgfVxuICB2YXIga2V5XG4gIHZhciB2YWx1ZVxuICB2YXIgZGF0YSA9IGluc3RhbmNlW2NoaW5kaW5nc1N5bV1cbiAgY29uc3Qgc3RyaW5naWZ5ID0gaW5zdGFuY2Vbc3RyaW5naWZ5U3ltXVxuICBjb25zdCBzdHJpbmdpZmllcnMgPSBpbnN0YW5jZVtzdHJpbmdpZmllcnNTeW1dXG4gIGNvbnN0IHNlcmlhbGl6ZXJzID0gaW5zdGFuY2Vbc2VyaWFsaXplcnNTeW1dXG4gIGlmIChzZXJpYWxpemVyc1t3aWxkY2FyZEdzeW1dKSB7XG4gICAgYmluZGluZ3MgPSBzZXJpYWxpemVyc1t3aWxkY2FyZEdzeW1dKGJpbmRpbmdzKVxuICB9XG4gIGZvciAoa2V5IGluIGJpbmRpbmdzKSB7XG4gICAgdmFsdWUgPSBiaW5kaW5nc1trZXldXG4gICAgY29uc3QgdmFsaWQgPSBrZXkgIT09ICdsZXZlbCcgJiZcbiAgICAgIGtleSAhPT0gJ3NlcmlhbGl6ZXJzJyAmJlxuICAgICAga2V5ICE9PSAnY3VzdG9tTGV2ZWxzJyAmJlxuICAgICAgYmluZGluZ3MuaGFzT3duUHJvcGVydHkoa2V5KSAmJlxuICAgICAgdmFsdWUgIT09IHVuZGVmaW5lZFxuICAgIGlmICh2YWxpZCA9PT0gdHJ1ZSkge1xuICAgICAgdmFsdWUgPSBzZXJpYWxpemVyc1trZXldID8gc2VyaWFsaXplcnNba2V5XSh2YWx1ZSkgOiB2YWx1ZVxuICAgICAgdmFsdWUgPSAoc3RyaW5naWZpZXJzW2tleV0gfHwgc3RyaW5naWZ5KSh2YWx1ZSlcbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgICAgZGF0YSArPSAnLFwiJyArIGtleSArICdcIjonICsgdmFsdWVcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRhdGFcbn1cblxuZnVuY3Rpb24gZ2V0UHJldHR5U3RyZWFtIChvcHRzLCBwcmV0dGlmaWVyLCBkZXN0KSB7XG4gIGlmIChwcmV0dGlmaWVyICYmIHR5cGVvZiBwcmV0dGlmaWVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHByZXR0aWZpZXJNZXRhV3JhcHBlcihwcmV0dGlmaWVyKG9wdHMpLCBkZXN0KVxuICB9XG4gIHRyeSB7XG4gICAgdmFyIHByZXR0eUZhY3RvcnkgPSByZXF1aXJlKCdwaW5vLXByZXR0eScpXG4gICAgcHJldHR5RmFjdG9yeS5hc01ldGFXcmFwcGVyID0gcHJldHRpZmllck1ldGFXcmFwcGVyXG4gICAgcmV0dXJuIHByZXR0aWZpZXJNZXRhV3JhcHBlcihwcmV0dHlGYWN0b3J5KG9wdHMpLCBkZXN0KVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgRXJyb3IoJ01pc3NpbmcgYHBpbm8tcHJldHR5YCBtb2R1bGU6IGBwaW5vLXByZXR0eWAgbXVzdCBiZSBpbnN0YWxsZWQgc2VwYXJhdGVseScpXG4gIH1cbn1cblxuZnVuY3Rpb24gcHJldHRpZmllck1ldGFXcmFwcGVyIChwcmV0dHksIGRlc3QpIHtcbiAgdmFyIHdhcm5lZCA9IGZhbHNlXG4gIHJldHVybiB7XG4gICAgW25lZWRzTWV0YWRhdGFHc3ltXTogdHJ1ZSxcbiAgICBsYXN0TGV2ZWw6IDAsXG4gICAgbGFzdE1zZzogbnVsbCxcbiAgICBsYXN0T2JqOiBudWxsLFxuICAgIGxhc3RMb2dnZXI6IG51bGwsXG4gICAgZmx1c2hTeW5jICgpIHtcbiAgICAgIGlmICh3YXJuZWQpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICB3YXJuZWQgPSB0cnVlXG4gICAgICBkZXN0LndyaXRlKHByZXR0eShPYmplY3QuYXNzaWduKHtcbiAgICAgICAgbGV2ZWw6IDQwLCAvLyB3YXJuXG4gICAgICAgIG1zZzogJ3Bpbm8uZmluYWwgd2l0aCBwcmV0dHlQcmludCBkb2VzIG5vdCBzdXBwb3J0IGZsdXNoaW5nJyxcbiAgICAgICAgdGltZTogRGF0ZS5ub3coKVxuICAgICAgfSwgdGhpcy5jaGluZGluZ3MoKSkpKVxuICAgIH0sXG4gICAgY2hpbmRpbmdzICgpIHtcbiAgICAgIGNvbnN0IGxhc3RMb2dnZXIgPSB0aGlzLmxhc3RMb2dnZXJcbiAgICAgIHZhciBjaGluZGluZ3MgPSBudWxsXG5cbiAgICAgIC8vIHByb3RlY3Rpb24gYWdhaW5zdCBmbHVzaFN5bmMgYmVpbmcgY2FsbGVkIGJlZm9yZSBsb2dnaW5nXG4gICAgICAvLyBhbnl0aGluZ1xuICAgICAgaWYgKCFsYXN0TG9nZ2VyKSB7XG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIGlmIChsYXN0TG9nZ2VyLmhhc093blByb3BlcnR5KHBhcnNlZENoaW5kaW5nc1N5bSkpIHtcbiAgICAgICAgY2hpbmRpbmdzID0gbGFzdExvZ2dlcltwYXJzZWRDaGluZGluZ3NTeW1dXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaGluZGluZ3MgPSBKU09OLnBhcnNlKCd7XCJ2XCI6MScgKyBsYXN0TG9nZ2VyW2NoaW5kaW5nc1N5bV0gKyAnfScpXG4gICAgICAgIGxhc3RMb2dnZXJbcGFyc2VkQ2hpbmRpbmdzU3ltXSA9IGNoaW5kaW5nc1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2hpbmRpbmdzXG4gICAgfSxcbiAgICB3cml0ZSAoY2h1bmspIHtcbiAgICAgIGNvbnN0IGxhc3RMb2dnZXIgPSB0aGlzLmxhc3RMb2dnZXJcbiAgICAgIGNvbnN0IGNoaW5kaW5ncyA9IHRoaXMuY2hpbmRpbmdzKClcblxuICAgICAgdmFyIHRpbWUgPSB0aGlzLmxhc3RUaW1lXG5cbiAgICAgIGlmICh0aW1lLm1hdGNoKC9eXFxkKy8pKSB7XG4gICAgICAgIHRpbWUgPSBwYXJzZUludCh0aW1lKVxuICAgICAgfVxuXG4gICAgICB2YXIgbGFzdE9iaiA9IHRoaXMubGFzdE9ialxuICAgICAgdmFyIG1zZyA9IHRoaXMubGFzdE1zZ1xuICAgICAgdmFyIGVycm9yUHJvcHMgPSBudWxsXG5cbiAgICAgIGlmIChsYXN0T2JqIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgbXNnID0gbXNnIHx8IGxhc3RPYmoubWVzc2FnZVxuICAgICAgICBlcnJvclByb3BzID0ge1xuICAgICAgICAgIHR5cGU6ICdFcnJvcicsXG4gICAgICAgICAgc3RhY2s6IGxhc3RPYmouc3RhY2tcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBvYmogPSBPYmplY3QuYXNzaWduKHtcbiAgICAgICAgbGV2ZWw6IHRoaXMubGFzdExldmVsLFxuICAgICAgICBtc2csXG4gICAgICAgIHRpbWVcbiAgICAgIH0sIGNoaW5kaW5ncywgbGFzdE9iaiwgZXJyb3JQcm9wcylcblxuICAgICAgY29uc3Qgc2VyaWFsaXplcnMgPSBsYXN0TG9nZ2VyW3NlcmlhbGl6ZXJzU3ltXVxuICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHNlcmlhbGl6ZXJzKVxuICAgICAgdmFyIGtleVxuXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAga2V5ID0ga2V5c1tpXVxuICAgICAgICBpZiAob2JqW2tleV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIG9ialtrZXldID0gc2VyaWFsaXplcnNba2V5XShvYmpba2V5XSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzdHJpbmdpZmllcnMgPSBsYXN0TG9nZ2VyW3N0cmluZ2lmaWVyc1N5bV1cbiAgICAgIGNvbnN0IHJlZGFjdCA9IHN0cmluZ2lmaWVyc1tyZWRhY3RGbXRTeW1dXG5cbiAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IHByZXR0eSh0eXBlb2YgcmVkYWN0ID09PSAnZnVuY3Rpb24nID8gcmVkYWN0KG9iaikgOiBvYmopXG4gICAgICBpZiAoZm9ybWF0dGVkID09PSB1bmRlZmluZWQpIHJldHVyblxuICAgICAgZGVzdC53cml0ZShmb3JtYXR0ZWQpXG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGhhc0JlZW5UYW1wZXJlZCAoc3RyZWFtKSB7XG4gIHJldHVybiBzdHJlYW0ud3JpdGUgIT09IHN0cmVhbS5jb25zdHJ1Y3Rvci5wcm90b3R5cGUud3JpdGVcbn1cblxuZnVuY3Rpb24gYnVpbGRTYWZlU29uaWNCb29tIChkZXN0LCBidWZmZXIgPSAwLCBzeW5jID0gdHJ1ZSkge1xuICBjb25zdCBzdHJlYW0gPSBuZXcgU29uaWNCb29tKGRlc3QsIGJ1ZmZlciwgc3luYylcbiAgc3RyZWFtLm9uKCdlcnJvcicsIGZpbHRlckJyb2tlblBpcGUpXG4gIHJldHVybiBzdHJlYW1cblxuICBmdW5jdGlvbiBmaWx0ZXJCcm9rZW5QaXBlIChlcnIpIHtcbiAgICAvLyBUT0RPIHZlcmlmeSBvbiBXaW5kb3dzXG4gICAgaWYgKGVyci5jb2RlID09PSAnRVBJUEUnKSB7XG4gICAgICAvLyBJZiB3ZSBnZXQgRVBJUEUsIHdlIHNob3VsZCBzdG9wIGxvZ2dpbmcgaGVyZVxuICAgICAgLy8gaG93ZXZlciB3ZSBoYXZlIG5vIGNvbnRyb2wgdG8gdGhlIGNvbnN1bWVyIG9mXG4gICAgICAvLyBTb25pY0Jvb20sIHNvIHdlIGp1c3Qgb3ZlcndyaXRlIHRoZSB3cml0ZSBtZXRob2RcbiAgICAgIHN0cmVhbS53cml0ZSA9IG5vb3BcbiAgICAgIHN0cmVhbS5lbmQgPSBub29wXG4gICAgICBzdHJlYW0uZmx1c2hTeW5jID0gbm9vcFxuICAgICAgc3RyZWFtLmRlc3Ryb3kgPSBub29wXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgc3RyZWFtLnJlbW92ZUxpc3RlbmVyKCdlcnJvcicsIGZpbHRlckJyb2tlblBpcGUpXG4gICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUFyZ3NOb3JtYWxpemVyIChkZWZhdWx0T3B0aW9ucykge1xuICByZXR1cm4gZnVuY3Rpb24gbm9ybWFsaXplQXJncyAob3B0cyA9IHt9LCBzdHJlYW0pIHtcbiAgICAvLyBzdXBwb3J0IHN0cmVhbSBhcyBhIHN0cmluZ1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHN0cmVhbSA9IGJ1aWxkU2FmZVNvbmljQm9vbShvcHRzKVxuICAgICAgb3B0cyA9IHt9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJykge1xuICAgICAgc3RyZWFtID0gYnVpbGRTYWZlU29uaWNCb29tKHN0cmVhbSlcbiAgICB9IGVsc2UgaWYgKG9wdHMgaW5zdGFuY2VvZiBTb25pY0Jvb20gfHwgb3B0cy53cml0YWJsZSB8fCBvcHRzLl93cml0YWJsZVN0YXRlKSB7XG4gICAgICBzdHJlYW0gPSBvcHRzXG4gICAgICBvcHRzID0gbnVsbFxuICAgIH1cbiAgICBvcHRzID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdE9wdGlvbnMsIG9wdHMpXG4gICAgaWYgKCdleHRyZW1lJyBpbiBvcHRzKSB7XG4gICAgICB0aHJvdyBFcnJvcignVGhlIGV4dHJlbWUgb3B0aW9uIGhhcyBiZWVuIHJlbW92ZWQsIHVzZSBwaW5vLmV4dHJlbWUgaW5zdGVhZCcpXG4gICAgfVxuICAgIGlmICgnb25UZXJtaW5hdGVkJyBpbiBvcHRzKSB7XG4gICAgICB0aHJvdyBFcnJvcignVGhlIG9uVGVybWluYXRlZCBvcHRpb24gaGFzIGJlZW4gcmVtb3ZlZCwgdXNlIHBpbm8uZmluYWwgaW5zdGVhZCcpXG4gICAgfVxuICAgIGNvbnN0IHsgZW5hYmxlZCwgcHJldHR5UHJpbnQsIHByZXR0aWZpZXIsIG1lc3NhZ2VLZXkgfSA9IG9wdHNcbiAgICBpZiAoZW5hYmxlZCA9PT0gZmFsc2UpIG9wdHMubGV2ZWwgPSAnc2lsZW50J1xuICAgIHN0cmVhbSA9IHN0cmVhbSB8fCBwcm9jZXNzLnN0ZG91dFxuICAgIGlmIChzdHJlYW0gPT09IHByb2Nlc3Muc3Rkb3V0ICYmIHN0cmVhbS5mZCA+PSAwICYmICFoYXNCZWVuVGFtcGVyZWQoc3RyZWFtKSkge1xuICAgICAgc3RyZWFtID0gYnVpbGRTYWZlU29uaWNCb29tKHN0cmVhbS5mZClcbiAgICB9XG4gICAgaWYgKHByZXR0eVByaW50KSB7XG4gICAgICBjb25zdCBwcmV0dHlPcHRzID0gT2JqZWN0LmFzc2lnbih7IG1lc3NhZ2VLZXkgfSwgcHJldHR5UHJpbnQpXG4gICAgICBzdHJlYW0gPSBnZXRQcmV0dHlTdHJlYW0ocHJldHR5T3B0cywgcHJldHRpZmllciwgc3RyZWFtKVxuICAgIH1cbiAgICByZXR1cm4geyBvcHRzLCBzdHJlYW0gfVxuICB9XG59XG5cbmZ1bmN0aW9uIGZpbmFsIChsb2dnZXIsIGhhbmRsZXIpIHtcbiAgaWYgKHR5cGVvZiBsb2dnZXIgPT09ICd1bmRlZmluZWQnIHx8IHR5cGVvZiBsb2dnZXIuY2hpbGQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBFcnJvcignZXhwZWN0ZWQgYSBwaW5vIGxvZ2dlciBpbnN0YW5jZScpXG4gIH1cbiAgY29uc3QgaGFzSGFuZGxlciA9ICh0eXBlb2YgaGFuZGxlciAhPT0gJ3VuZGVmaW5lZCcpXG4gIGlmIChoYXNIYW5kbGVyICYmIHR5cGVvZiBoYW5kbGVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgRXJyb3IoJ2lmIHN1cHBsaWVkLCB0aGUgaGFuZGxlciBwYXJhbWV0ZXIgc2hvdWxkIGJlIGEgZnVuY3Rpb24nKVxuICB9XG4gIGNvbnN0IHN0cmVhbSA9IGxvZ2dlcltzdHJlYW1TeW1dXG4gIGlmICh0eXBlb2Ygc3RyZWFtLmZsdXNoU3luYyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IEVycm9yKCdmaW5hbCByZXF1aXJlcyBhIHN0cmVhbSB0aGF0IGhhcyBhIGZsdXNoU3luYyBtZXRob2QsIHN1Y2ggYXMgcGluby5kZXN0aW5hdGlvbiBhbmQgcGluby5leHRyZW1lJylcbiAgfVxuXG4gIGNvbnN0IGZpbmFsTG9nZ2VyID0gbmV3IFByb3h5KGxvZ2dlciwge1xuICAgIGdldDogKGxvZ2dlciwga2V5KSA9PiB7XG4gICAgICBpZiAoa2V5IGluIGxvZ2dlci5sZXZlbHMudmFsdWVzKSB7XG4gICAgICAgIHJldHVybiAoLi4uYXJncykgPT4ge1xuICAgICAgICAgIGxvZ2dlcltrZXldKC4uLmFyZ3MpXG4gICAgICAgICAgc3RyZWFtLmZsdXNoU3luYygpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBsb2dnZXJba2V5XVxuICAgIH1cbiAgfSlcblxuICBpZiAoIWhhc0hhbmRsZXIpIHtcbiAgICByZXR1cm4gZmluYWxMb2dnZXJcbiAgfVxuXG4gIHJldHVybiAoZXJyID0gbnVsbCwgLi4uYXJncykgPT4ge1xuICAgIHRyeSB7XG4gICAgICBzdHJlYW0uZmx1c2hTeW5jKClcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBpdCdzIHRvbyBsYXRlIHRvIHdhaXQgZm9yIHRoZSBzdHJlYW0gdG8gYmUgcmVhZHlcbiAgICAgIC8vIGJlY2F1c2UgdGhpcyBpcyBhIGZpbmFsIHRpY2sgc2NlbmFyaW8uXG4gICAgICAvLyBpbiBwcmFjdGljZSB0aGVyZSBzaG91bGRuJ3QgYmUgYSBzaXR1YXRpb24gd2hlcmUgaXQgaXNuJ3RcbiAgICAgIC8vIGhvd2V2ZXIsIHN3YWxsb3cgdGhlIGVycm9yIGp1c3QgaW4gY2FzZSAoYW5kIGZvciBlYXNpZXIgdGVzdGluZylcbiAgICB9XG4gICAgcmV0dXJuIGhhbmRsZXIoZXJyLCBmaW5hbExvZ2dlciwgLi4uYXJncylcbiAgfVxufVxuXG5mdW5jdGlvbiBzdHJpbmdpZnkgKG9iaikge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShvYmopXG4gIH0gY2F0Y2ggKF8pIHtcbiAgICByZXR1cm4gc3RyaW5naWZ5U2FmZShvYmopXG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG5vb3AsXG4gIGJ1aWxkU2FmZVNvbmljQm9vbSxcbiAgZ2V0UHJldHR5U3RyZWFtLFxuICBhc0NoaW5kaW5ncyxcbiAgYXNKc29uLFxuICBnZW5Mb2csXG4gIGNyZWF0ZUFyZ3NOb3JtYWxpemVyLFxuICBmaW5hbCxcbiAgc3RyaW5naWZ5XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoXCJ1dGlsXCIpOyIsIi8qXG4gKiAgKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrXG4gKiAgQ29weXJpZ2h0IDIwMTkgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqICBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuICogICsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrK1xuICovXG5cbmV4cG9ydCBjb25zdCBUaW1lID0ge1xuICAgIHNlcnZlclRpbWVHZXREYXk6IChkYXRlID0gbmV3IERhdGUoKSkgPT4ge1xuICAgICAgICByZXR1cm4gZGF0ZS5nZXREYXkoKTtcbiAgICB9XG59O1xuXG4iLCIndXNlIHN0cmljdCdcblxuY29uc3QgY2hhbGsgPSByZXF1aXJlKCdjaGFsaycpXG5jb25zdCBkYXRlZm9ybWF0ID0gcmVxdWlyZSgnZGF0ZWZvcm1hdCcpXG4vLyByZW1vdmUganNvblBhcnNlciBvbmNlIE5vZGUgNiBpcyBub3Qgc3VwcG9ydGVkIGFueW1vcmVcbmNvbnN0IGpzb25QYXJzZXIgPSByZXF1aXJlKCdmYXN0LWpzb24tcGFyc2UnKVxuY29uc3Qgam1lc3BhdGggPSByZXF1aXJlKCdqbWVzcGF0aCcpXG5jb25zdCBzdHJpbmdpZnlTYWZlID0gcmVxdWlyZSgnZmFzdC1zYWZlLXN0cmluZ2lmeScpXG5cbmNvbnN0IENPTlNUQU5UUyA9IHJlcXVpcmUoJy4vbGliL2NvbnN0YW50cycpXG5cbmNvbnN0IGxldmVscyA9IHtcbiAgZGVmYXVsdDogJ1VTRVJMVkwnLFxuICA2MDogJ0ZBVEFMJyxcbiAgNTA6ICdFUlJPUicsXG4gIDQwOiAnV0FSTiAnLFxuICAzMDogJ0lORk8gJyxcbiAgMjA6ICdERUJVRycsXG4gIDEwOiAnVFJBQ0UnXG59XG5cbmNvbnN0IGRlZmF1bHRPcHRpb25zID0ge1xuICBjb2xvcml6ZTogY2hhbGsuc3VwcG9ydHNDb2xvcixcbiAgY3JsZjogZmFsc2UsXG4gIGVycm9yTGlrZU9iamVjdEtleXM6IFsnZXJyJywgJ2Vycm9yJ10sXG4gIGVycm9yUHJvcHM6ICcnLFxuICBsZXZlbEZpcnN0OiBmYWxzZSxcbiAgbWVzc2FnZUtleTogQ09OU1RBTlRTLk1FU1NBR0VfS0VZLFxuICB0cmFuc2xhdGVUaW1lOiBmYWxzZSxcbiAgdXNlTWV0YWRhdGE6IGZhbHNlLFxuICBvdXRwdXRTdHJlYW06IHByb2Nlc3Muc3Rkb3V0XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0IChpbnB1dCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5hcHBseShpbnB1dCkgPT09ICdbb2JqZWN0IE9iamVjdF0nXG59XG5cbmZ1bmN0aW9uIGlzUGlub0xvZyAobG9nKSB7XG4gIHJldHVybiBsb2cgJiYgKGxvZy5oYXNPd25Qcm9wZXJ0eSgndicpICYmIGxvZy52ID09PSAxKVxufVxuXG5mdW5jdGlvbiBmb3JtYXRUaW1lIChlcG9jaCwgdHJhbnNsYXRlVGltZSkge1xuICBjb25zdCBpbnN0YW50ID0gbmV3IERhdGUoZXBvY2gpXG4gIGlmICh0cmFuc2xhdGVUaW1lID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIGRhdGVmb3JtYXQoaW5zdGFudCwgJ1VUQzonICsgQ09OU1RBTlRTLkRBVEVfRk9STUFUKVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IHVwcGVyRm9ybWF0ID0gdHJhbnNsYXRlVGltZS50b1VwcGVyQ2FzZSgpXG4gICAgcmV0dXJuICghdXBwZXJGb3JtYXQuc3RhcnRzV2l0aCgnU1lTOicpKVxuICAgICAgPyBkYXRlZm9ybWF0KGluc3RhbnQsICdVVEM6JyArIHRyYW5zbGF0ZVRpbWUpXG4gICAgICA6ICh1cHBlckZvcm1hdCA9PT0gJ1NZUzpTVEFOREFSRCcpXG4gICAgICAgID8gZGF0ZWZvcm1hdChpbnN0YW50LCBDT05TVEFOVFMuREFURV9GT1JNQVQpXG4gICAgICAgIDogZGF0ZWZvcm1hdChpbnN0YW50LCB0cmFuc2xhdGVUaW1lLnNsaWNlKDQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vY29sb3IgKGlucHV0KSB7XG4gIHJldHVybiBpbnB1dFxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHByZXR0eUZhY3RvcnkgKG9wdGlvbnMpIHtcbiAgY29uc3Qgb3B0cyA9IE9iamVjdC5hc3NpZ24oe30sIGRlZmF1bHRPcHRpb25zLCBvcHRpb25zKVxuICBjb25zdCBFT0wgPSBvcHRzLmNybGYgPyAnXFxyXFxuJyA6ICdcXG4nXG4gIGNvbnN0IElERU5UID0gJyAgICAnXG4gIGNvbnN0IG1lc3NhZ2VLZXkgPSBvcHRzLm1lc3NhZ2VLZXlcbiAgY29uc3QgZXJyb3JMaWtlT2JqZWN0S2V5cyA9IG9wdHMuZXJyb3JMaWtlT2JqZWN0S2V5c1xuICBjb25zdCBlcnJvclByb3BzID0gb3B0cy5lcnJvclByb3BzLnNwbGl0KCcsJylcblxuICBjb25zdCBjb2xvciA9IHtcbiAgICBkZWZhdWx0OiBub2NvbG9yLFxuICAgIDYwOiBub2NvbG9yLFxuICAgIDUwOiBub2NvbG9yLFxuICAgIDQwOiBub2NvbG9yLFxuICAgIDMwOiBub2NvbG9yLFxuICAgIDIwOiBub2NvbG9yLFxuICAgIDEwOiBub2NvbG9yLFxuICAgIG1lc3NhZ2U6IG5vY29sb3JcbiAgfVxuICBpZiAob3B0cy5jb2xvcml6ZSkge1xuICAgIGNvbnN0IGN0eCA9IG5ldyBjaGFsay5jb25zdHJ1Y3Rvcih7IGVuYWJsZWQ6IHRydWUsIGxldmVsOiAzIH0pXG4gICAgY29sb3IuZGVmYXVsdCA9IGN0eC53aGl0ZVxuICAgIGNvbG9yWzYwXSA9IGN0eC5iZ1JlZFxuICAgIGNvbG9yWzUwXSA9IGN0eC5yZWRcbiAgICBjb2xvcls0MF0gPSBjdHgueWVsbG93XG4gICAgY29sb3JbMzBdID0gY3R4LmdyZWVuXG4gICAgY29sb3JbMjBdID0gY3R4LmJsdWVcbiAgICBjb2xvclsxMF0gPSBjdHguZ3JleVxuICAgIGNvbG9yLm1lc3NhZ2UgPSBjdHguY3lhblxuICB9XG5cbiAgY29uc3Qgc2VhcmNoID0gb3B0cy5zZWFyY2hcblxuICByZXR1cm4gcHJldHR5XG5cbiAgZnVuY3Rpb24gcHJldHR5IChpbnB1dERhdGEpIHtcbiAgICBsZXQgbG9nXG4gICAgaWYgKCFpc09iamVjdChpbnB1dERhdGEpKSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBqc29uUGFyc2VyKGlucHV0RGF0YSlcbiAgICAgIGxvZyA9IHBhcnNlZC52YWx1ZVxuICAgICAgaWYgKHBhcnNlZC5lcnIgfHwgIWlzUGlub0xvZyhsb2cpKSB7XG4gICAgICAgIC8vIHBhc3MgdGhyb3VnaFxuICAgICAgICByZXR1cm4gaW5wdXREYXRhICsgRU9MXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZyA9IGlucHV0RGF0YVxuICAgIH1cblxuICAgIGlmIChzZWFyY2ggJiYgIWptZXNwYXRoLnNlYXJjaChsb2csIHNlYXJjaCkpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHN0YW5kYXJkS2V5cyA9IFtcbiAgICAgICdwaWQnLFxuICAgICAgJ2hvc3RuYW1lJyxcbiAgICAgICduYW1lJyxcbiAgICAgICdsZXZlbCcsXG4gICAgICAndGltZScsXG4gICAgICAndidcbiAgICBdXG5cbiAgICBpZiAob3B0cy50cmFuc2xhdGVUaW1lKSB7XG4gICAgICBsb2cudGltZSA9IGZvcm1hdFRpbWUobG9nLnRpbWUsIG9wdHMudHJhbnNsYXRlVGltZSlcbiAgICB9XG5cbiAgICB2YXIgbGluZSA9IGxvZy50aW1lID8gYFske2xvZy50aW1lfV1gIDogJydcblxuICAgIGNvbnN0IGNvbG9yZWRMZXZlbCA9IGxldmVscy5oYXNPd25Qcm9wZXJ0eShsb2cubGV2ZWwpXG4gICAgICA/IGNvbG9yW2xvZy5sZXZlbF0obGV2ZWxzW2xvZy5sZXZlbF0pXG4gICAgICA6IGNvbG9yLmRlZmF1bHQobGV2ZWxzLmRlZmF1bHQpXG4gICAgaWYgKG9wdHMubGV2ZWxGaXJzdCkge1xuICAgICAgbGluZSA9IGAke2NvbG9yZWRMZXZlbH0gJHtsaW5lfWBcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgdGhlIGxpbmUgaXMgbm90IGVtcHR5ICh0aW1lc3RhbXBzIGFyZSBlbmFibGVkKSBvdXRwdXQgaXRcbiAgICAgIC8vIHdpdGggYSBzcGFjZSBhZnRlciBpdCAtIG90aGVyd2lzZSBvdXRwdXQgdGhlIGVtcHR5IHN0cmluZ1xuICAgICAgY29uc3QgbGluZU9yRW1wdHkgPSBsaW5lICYmIGxpbmUgKyAnICdcbiAgICAgIGxpbmUgPSBgJHtsaW5lT3JFbXB0eX0ke2NvbG9yZWRMZXZlbH1gXG4gICAgfVxuXG4gICAgaWYgKGxvZy5uYW1lIHx8IGxvZy5waWQgfHwgbG9nLmhvc3RuYW1lKSB7XG4gICAgICBsaW5lICs9ICcgKCdcblxuICAgICAgaWYgKGxvZy5uYW1lKSB7XG4gICAgICAgIGxpbmUgKz0gbG9nLm5hbWVcbiAgICAgIH1cblxuICAgICAgaWYgKGxvZy5uYW1lICYmIGxvZy5waWQpIHtcbiAgICAgICAgbGluZSArPSAnLycgKyBsb2cucGlkXG4gICAgICB9IGVsc2UgaWYgKGxvZy5waWQpIHtcbiAgICAgICAgbGluZSArPSBsb2cucGlkXG4gICAgICB9XG5cbiAgICAgIGlmIChsb2cuaG9zdG5hbWUpIHtcbiAgICAgICAgbGluZSArPSAnIG9uICcgKyBsb2cuaG9zdG5hbWVcbiAgICAgIH1cblxuICAgICAgbGluZSArPSAnKSdcbiAgICB9XG5cbiAgICBsaW5lICs9ICc6ICdcblxuICAgIGlmIChsb2dbbWVzc2FnZUtleV0gJiYgdHlwZW9mIGxvZ1ttZXNzYWdlS2V5XSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGxpbmUgKz0gY29sb3IubWVzc2FnZShsb2dbbWVzc2FnZUtleV0pXG4gICAgfVxuXG4gICAgbGluZSArPSBFT0xcblxuICAgIGlmIChsb2cudHlwZSA9PT0gJ0Vycm9yJyAmJiBsb2cuc3RhY2spIHtcbiAgICAgIGNvbnN0IHN0YWNrID0gbG9nLnN0YWNrXG4gICAgICBsaW5lICs9IElERU5UICsgam9pbkxpbmVzV2l0aEluZGVudGF0aW9uKHN0YWNrKSArIEVPTFxuXG4gICAgICBsZXQgcHJvcHNGb3JQcmludFxuICAgICAgaWYgKGVycm9yUHJvcHMgJiYgZXJyb3JQcm9wcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIGRvbid0IG5lZWQgcHJpbnQgdGhlc2UgcHJvcHMgZm9yICdFcnJvcicgb2JqZWN0XG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVkUHJvcHMgPSBzdGFuZGFyZEtleXMuY29uY2F0KFttZXNzYWdlS2V5LCAndHlwZScsICdzdGFjayddKVxuXG4gICAgICAgIGlmIChlcnJvclByb3BzWzBdID09PSAnKicpIHtcbiAgICAgICAgICAvLyBwcmludCBhbGwgbG9nIHByb3BzIGV4Y2x1ZGluZyAnZXhjbHVkZWRQcm9wcydcbiAgICAgICAgICBwcm9wc0ZvclByaW50ID0gT2JqZWN0LmtleXMobG9nKS5maWx0ZXIoKHByb3ApID0+IGV4Y2x1ZGVkUHJvcHMuaW5kZXhPZihwcm9wKSA8IDApXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gcHJpbnQgcHJvcHMgZnJvbSAnZXJyb3JQcm9wcycgb25seVxuICAgICAgICAgIC8vIGJ1dCBleGNsdWRlICdleGNsdWRlZFByb3BzJ1xuICAgICAgICAgIHByb3BzRm9yUHJpbnQgPSBlcnJvclByb3BzLmZpbHRlcigocHJvcCkgPT4gZXhjbHVkZWRQcm9wcy5pbmRleE9mKHByb3ApIDwgMClcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJvcHNGb3JQcmludC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGNvbnN0IGtleSA9IHByb3BzRm9yUHJpbnRbaV1cbiAgICAgICAgICBpZiAoIWxvZy5oYXNPd25Qcm9wZXJ0eShrZXkpKSBjb250aW51ZVxuICAgICAgICAgIGlmIChsb2dba2V5XSBpbnN0YW5jZW9mIE9iamVjdCkge1xuICAgICAgICAgICAgLy8gY2FsbCAnZmlsdGVyT2JqZWN0cycgd2l0aCAnZXhjbHVkZVN0YW5kYXJkS2V5cycgPSBmYWxzZVxuICAgICAgICAgICAgLy8gYmVjYXVzZSBuZXN0ZWQgcHJvcGVydHkgbWlnaHQgY29udGFpbiBwcm9wZXJ0eSBmcm9tICdzdGFuZGFyZEtleXMnXG4gICAgICAgICAgICBsaW5lICs9IGtleSArICc6IHsnICsgRU9MICsgZmlsdGVyT2JqZWN0cyhsb2dba2V5XSwgJycsIGVycm9yTGlrZU9iamVjdEtleXMsIGZhbHNlKSArICd9JyArIEVPTFxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgICAgbGluZSArPSBrZXkgKyAnOiAnICsgbG9nW2tleV0gKyBFT0xcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lICs9IGZpbHRlck9iamVjdHMobG9nLCB0eXBlb2YgbG9nW21lc3NhZ2VLZXldID09PSAnc3RyaW5nJyA/IG1lc3NhZ2VLZXkgOiB1bmRlZmluZWQsIGVycm9yTGlrZU9iamVjdEtleXMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGxpbmVcblxuICAgIGZ1bmN0aW9uIGpvaW5MaW5lc1dpdGhJbmRlbnRhdGlvbiAodmFsdWUpIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gdmFsdWUuc3BsaXQoL1xccj9cXG4vKVxuICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsaW5lc1tpXSA9IElERU5UICsgbGluZXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBsaW5lcy5qb2luKEVPTClcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJPYmplY3RzICh2YWx1ZSwgbWVzc2FnZUtleSwgZXJyb3JMaWtlT2JqZWN0S2V5cywgZXhjbHVkZVN0YW5kYXJkS2V5cykge1xuICAgICAgZXJyb3JMaWtlT2JqZWN0S2V5cyA9IGVycm9yTGlrZU9iamVjdEtleXMgfHwgW11cblxuICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHZhbHVlKVxuICAgICAgY29uc3QgZmlsdGVyZWRLZXlzID0gW11cblxuICAgICAgaWYgKG1lc3NhZ2VLZXkpIHtcbiAgICAgICAgZmlsdGVyZWRLZXlzLnB1c2gobWVzc2FnZUtleSlcbiAgICAgIH1cblxuICAgICAgaWYgKGV4Y2x1ZGVTdGFuZGFyZEtleXMgIT09IGZhbHNlKSB7XG4gICAgICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KGZpbHRlcmVkS2V5cywgc3RhbmRhcmRLZXlzKVxuICAgICAgfVxuXG4gICAgICBsZXQgcmVzdWx0ID0gJydcblxuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGlmIChlcnJvckxpa2VPYmplY3RLZXlzLmluZGV4T2Yoa2V5c1tpXSkgIT09IC0xICYmIHZhbHVlW2tleXNbaV1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjb25zdCBsaW5lcyA9IHN0cmluZ2lmeVNhZmUodmFsdWVba2V5c1tpXV0sIG51bGwsIDIpXG4gICAgICAgICAgaWYgKGxpbmVzID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG4gICAgICAgICAgY29uc3QgYXJyYXlPZkxpbmVzID0gKFxuICAgICAgICAgICAgSURFTlQgKyBrZXlzW2ldICsgJzogJyArXG4gICAgICAgICAgICBqb2luTGluZXNXaXRoSW5kZW50YXRpb24obGluZXMpICtcbiAgICAgICAgICAgIEVPTFxuICAgICAgICAgICkuc3BsaXQoJ1xcbicpXG5cbiAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGFycmF5T2ZMaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgICAgICAgaWYgKGogIT09IDApIHtcbiAgICAgICAgICAgICAgcmVzdWx0ICs9ICdcXG4nXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSBhcnJheU9mTGluZXNbal1cblxuICAgICAgICAgICAgaWYgKC9eXFxzKlwic3RhY2tcIi8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gL14oXFxzKlwic3RhY2tcIjopXFxzKihcIi4qXCIpLD8kLy5leGVjKGxpbmUpXG5cbiAgICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgbWF0Y2hlcy5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRlbnRTaXplID0gL15cXHMqLy5leGVjKGxpbmUpWzBdLmxlbmd0aCArIDRcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRlbnRhdGlvbiA9ICcgJy5yZXBlYXQoaW5kZW50U2l6ZSlcblxuICAgICAgICAgICAgICAgIHJlc3VsdCArPSBtYXRjaGVzWzFdICsgJ1xcbicgKyBpbmRlbnRhdGlvbiArIEpTT04ucGFyc2UobWF0Y2hlc1syXSkucmVwbGFjZSgvXFxuL2csICdcXG4nICsgaW5kZW50YXRpb24pXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc3VsdCArPSBsaW5lXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlcmVkS2V5cy5pbmRleE9mKGtleXNbaV0pIDwgMCkge1xuICAgICAgICAgIGlmICh2YWx1ZVtrZXlzW2ldXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lcyA9IHN0cmluZ2lmeVNhZmUodmFsdWVba2V5c1tpXV0sIG51bGwsIDIpXG4gICAgICAgICAgICBpZiAobGluZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICByZXN1bHQgKz0gSURFTlQgKyBrZXlzW2ldICsgJzogJyArIGpvaW5MaW5lc1dpdGhJbmRlbnRhdGlvbihsaW5lcykgKyBFT0xcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH1cbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwib3NcIik7IiwiJ3VzZSBzdHJpY3QnXG5cbnZhciBlcnJTZXJpYWxpemVyID0gcmVxdWlyZSgnLi9saWIvZXJyJylcbnZhciByZXFTZXJpYWxpemVycyA9IHJlcXVpcmUoJy4vbGliL3JlcScpXG52YXIgcmVzU2VyaWFsaXplcnMgPSByZXF1aXJlKCcuL2xpYi9yZXMnKVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZXJyOiBlcnJTZXJpYWxpemVyLFxuICBtYXBIdHRwUmVxdWVzdDogcmVxU2VyaWFsaXplcnMubWFwSHR0cFJlcXVlc3QsXG4gIG1hcEh0dHBSZXNwb25zZTogcmVzU2VyaWFsaXplcnMubWFwSHR0cFJlc3BvbnNlLFxuICByZXE6IHJlcVNlcmlhbGl6ZXJzLnJlcVNlcmlhbGl6ZXIsXG4gIHJlczogcmVzU2VyaWFsaXplcnMucmVzU2VyaWFsaXplcixcblxuICB3cmFwRXJyb3JTZXJpYWxpemVyOiBmdW5jdGlvbiB3cmFwRXJyb3JTZXJpYWxpemVyIChjdXN0b21TZXJpYWxpemVyKSB7XG4gICAgaWYgKGN1c3RvbVNlcmlhbGl6ZXIgPT09IGVyclNlcmlhbGl6ZXIpIHJldHVybiBjdXN0b21TZXJpYWxpemVyXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHdyYXBFcnJTZXJpYWxpemVyIChlcnIpIHtcbiAgICAgIHJldHVybiBjdXN0b21TZXJpYWxpemVyKGVyclNlcmlhbGl6ZXIoZXJyKSlcbiAgICB9XG4gIH0sXG5cbiAgd3JhcFJlcXVlc3RTZXJpYWxpemVyOiBmdW5jdGlvbiB3cmFwUmVxdWVzdFNlcmlhbGl6ZXIgKGN1c3RvbVNlcmlhbGl6ZXIpIHtcbiAgICBpZiAoY3VzdG9tU2VyaWFsaXplciA9PT0gcmVxU2VyaWFsaXplcnMucmVxU2VyaWFsaXplcikgcmV0dXJuIGN1c3RvbVNlcmlhbGl6ZXJcbiAgICByZXR1cm4gZnVuY3Rpb24gd3JhcHBlZFJlcVNlcmlhbGl6ZXIgKHJlcSkge1xuICAgICAgcmV0dXJuIGN1c3RvbVNlcmlhbGl6ZXIocmVxU2VyaWFsaXplcnMucmVxU2VyaWFsaXplcihyZXEpKVxuICAgIH1cbiAgfSxcblxuICB3cmFwUmVzcG9uc2VTZXJpYWxpemVyOiBmdW5jdGlvbiB3cmFwUmVzcG9uc2VTZXJpYWxpemVyIChjdXN0b21TZXJpYWxpemVyKSB7XG4gICAgaWYgKGN1c3RvbVNlcmlhbGl6ZXIgPT09IHJlc1NlcmlhbGl6ZXJzLnJlc1NlcmlhbGl6ZXIpIHJldHVybiBjdXN0b21TZXJpYWxpemVyXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHdyYXBwZWRSZXNTZXJpYWxpemVyIChyZXMpIHtcbiAgICAgIHJldHVybiBjdXN0b21TZXJpYWxpemVyKHJlc1NlcmlhbGl6ZXJzLnJlc1NlcmlhbGl6ZXIocmVzKSlcbiAgICB9XG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZ3JvdXBSZWRhY3QsXG4gIGdyb3VwUmVzdG9yZSxcbiAgbmVzdGVkUmVkYWN0LFxuICBuZXN0ZWRSZXN0b3JlXG59XG5cbmZ1bmN0aW9uIGdyb3VwUmVzdG9yZSAoeyBrZXlzLCB2YWx1ZXMsIHRhcmdldCB9KSB7XG4gIGlmICh0YXJnZXQgPT0gbnVsbCkgcmV0dXJuXG4gIGNvbnN0IGxlbmd0aCA9IGtleXMubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBrID0ga2V5c1tpXVxuICAgIHRhcmdldFtrXSA9IHZhbHVlc1tpXVxuICB9XG59XG5cbmZ1bmN0aW9uIGdyb3VwUmVkYWN0IChvLCBwYXRoLCBjZW5zb3IsIGlzQ2Vuc29yRmN0KSB7XG4gIGNvbnN0IHRhcmdldCA9IGdldChvLCBwYXRoKVxuICBpZiAodGFyZ2V0ID09IG51bGwpIHJldHVybiB7IGtleXM6IG51bGwsIHZhbHVlczogbnVsbCwgdGFyZ2V0OiBudWxsLCBmbGF0OiB0cnVlIH1cbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHRhcmdldClcbiAgY29uc3QgbGVuZ3RoID0ga2V5cy5sZW5ndGhcbiAgY29uc3QgdmFsdWVzID0gbmV3IEFycmF5KGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGsgPSBrZXlzW2ldXG4gICAgdmFsdWVzW2ldID0gdGFyZ2V0W2tdXG4gICAgdGFyZ2V0W2tdID0gaXNDZW5zb3JGY3QgPyBjZW5zb3IodGFyZ2V0W2tdKSA6IGNlbnNvclxuICB9XG4gIHJldHVybiB7IGtleXMsIHZhbHVlcywgdGFyZ2V0LCBmbGF0OiB0cnVlIH1cbn1cblxuZnVuY3Rpb24gbmVzdGVkUmVzdG9yZSAoYXJyKSB7XG4gIGNvbnN0IGxlbmd0aCA9IGFyci5sZW5ndGhcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHsga2V5LCB0YXJnZXQsIHZhbHVlIH0gPSBhcnJbaV1cbiAgICB0YXJnZXRba2V5XSA9IHZhbHVlXG4gIH1cbn1cblxuZnVuY3Rpb24gbmVzdGVkUmVkYWN0IChzdG9yZSwgbywgcGF0aCwgbnMsIGNlbnNvciwgaXNDZW5zb3JGY3QpIHtcbiAgY29uc3QgdGFyZ2V0ID0gZ2V0KG8sIHBhdGgpXG4gIGlmICh0YXJnZXQgPT0gbnVsbCkgcmV0dXJuXG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXQpXG4gIGNvbnN0IGxlbmd0aCA9IGtleXMubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBrZXkgPSBrZXlzW2ldXG4gICAgY29uc3QgeyB2YWx1ZSwgcGFyZW50LCBleGlzdHMgfSA9IHNwZWNpYWxTZXQodGFyZ2V0LCBrZXksIG5zLCBjZW5zb3IsIGlzQ2Vuc29yRmN0KVxuXG4gICAgaWYgKGV4aXN0cyA9PT0gdHJ1ZSAmJiBwYXJlbnQgIT09IG51bGwpIHtcbiAgICAgIHN0b3JlLnB1c2goeyBrZXk6IG5zW25zLmxlbmd0aCAtIDFdLCB0YXJnZXQ6IHBhcmVudCwgdmFsdWUgfSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0b3JlXG59XG5cbmZ1bmN0aW9uIGhhcyAob2JqLCBwcm9wKSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKVxufVxuXG5mdW5jdGlvbiBzcGVjaWFsU2V0IChvLCBrLCBwLCB2LCBmKSB7XG4gIHZhciBpID0gLTFcbiAgdmFyIGwgPSBwLmxlbmd0aFxuICB2YXIgbGkgPSBsIC0gMVxuICB2YXIgblxuICB2YXIgbnZcbiAgdmFyIG92XG4gIHZhciBvb3YgPSBudWxsXG4gIHZhciBleGlzdHMgPSB0cnVlXG4gIG92ID0gbiA9IG9ba11cbiAgaWYgKHR5cGVvZiBuICE9PSAnb2JqZWN0JykgcmV0dXJuIHsgdmFsdWU6IG51bGwsIHBhcmVudDogbnVsbCwgZXhpc3RzIH1cbiAgd2hpbGUgKG4gIT0gbnVsbCAmJiArK2kgPCBsKSB7XG4gICAgayA9IHBbaV1cbiAgICBvb3YgPSBvdlxuICAgIGlmICghKGsgaW4gbikpIHtcbiAgICAgIGV4aXN0cyA9IGZhbHNlXG4gICAgICBicmVha1xuICAgIH1cbiAgICBvdiA9IG5ba11cbiAgICBudiA9IGYgPyB2KG92KSA6IHZcbiAgICBudiA9IChpICE9PSBsaSkgPyBvdiA6IG52XG4gICAgbltrXSA9IChoYXMobiwgaykgJiYgbnYgPT09IG92KSB8fCAobnYgPT09IHVuZGVmaW5lZCAmJiB2ICE9PSB1bmRlZmluZWQpID8gbltrXSA6IG52XG4gICAgbiA9IG5ba11cbiAgICBpZiAodHlwZW9mIG4gIT09ICdvYmplY3QnKSBicmVha1xuICB9XG4gIHJldHVybiB7IHZhbHVlOiBvdiwgcGFyZW50OiBvb3YsIGV4aXN0cyB9XG59XG5mdW5jdGlvbiBnZXQgKG8sIHApIHtcbiAgdmFyIGkgPSAtMVxuICB2YXIgbCA9IHAubGVuZ3RoXG4gIHZhciBuID0gb1xuICB3aGlsZSAobiAhPSBudWxsICYmICsraSA8IGwpIHtcbiAgICBuID0gbltwW2ldXVxuICB9XG4gIHJldHVybiBuXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoXCJldmVudHNcIik7IiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuY29uc3QgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJylcbmNvbnN0IGZsYXRzdHIgPSByZXF1aXJlKCdmbGF0c3RyJylcbmNvbnN0IGluaGVyaXRzID0gcmVxdWlyZSgndXRpbCcpLmluaGVyaXRzXG5cbi8vIDE2IE1CIC0gbWFnaWMgbnVtYmVyXG4vLyBUaGlzIGNvbnN0YW50IGVuc3VyZXMgdGhhdCBTb25pY0Jvb20gb25seSBuZWVkc1xuLy8gMzIgTUIgb2YgZnJlZSBtZW1vcnkgdG8gcnVuLiBJbiBjYXNlIG9mIGhhdmluZyAxR0IrXG4vLyBvZiBkYXRhIHRvIHdyaXRlLCB0aGlzIHByZXZlbnRzIGFuIG91dCBvZiBtZW1vcnlcbi8vIGNvbmRpdGlvbi5cbmNvbnN0IE1BWF9XUklURSA9IDE2ICogMTAyNCAqIDEwMjRcblxuZnVuY3Rpb24gb3BlbkZpbGUgKGZpbGUsIHNvbmljKSB7XG4gIHNvbmljLl9vcGVuaW5nID0gdHJ1ZVxuICBzb25pYy5fd3JpdGluZyA9IHRydWVcbiAgc29uaWMuZmlsZSA9IGZpbGVcbiAgZnMub3BlbihmaWxlLCAnYScsIChlcnIsIGZkKSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgc29uaWMuZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBzb25pYy5mZCA9IGZkXG4gICAgc29uaWMuX3Jlb3BlbmluZyA9IGZhbHNlXG4gICAgc29uaWMuX29wZW5pbmcgPSBmYWxzZVxuICAgIHNvbmljLl93cml0aW5nID0gZmFsc2VcblxuICAgIHNvbmljLmVtaXQoJ3JlYWR5JylcblxuICAgIGlmIChzb25pYy5fcmVvcGVuaW5nKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBzdGFydFxuICAgIHZhciBsZW4gPSBzb25pYy5fYnVmLmxlbmd0aFxuICAgIGlmIChsZW4gPiAwICYmIGxlbiA+IHNvbmljLm1pbkxlbmd0aCAmJiAhc29uaWMuZGVzdHJveWVkKSB7XG4gICAgICBhY3R1YWxXcml0ZShzb25pYylcbiAgICB9XG4gIH0pXG59XG5cbmZ1bmN0aW9uIFNvbmljQm9vbSAoZmQsIG1pbkxlbmd0aCwgc3luYykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU29uaWNCb29tKSkge1xuICAgIHJldHVybiBuZXcgU29uaWNCb29tKGZkLCBtaW5MZW5ndGgsIHN5bmMpXG4gIH1cblxuICB0aGlzLl9idWYgPSAnJ1xuICB0aGlzLmZkID0gLTFcbiAgdGhpcy5fd3JpdGluZyA9IGZhbHNlXG4gIHRoaXMuX3dyaXRpbmdCdWYgPSAnJ1xuICB0aGlzLl9lbmRpbmcgPSBmYWxzZVxuICB0aGlzLl9yZW9wZW5pbmcgPSBmYWxzZVxuICB0aGlzLl9hc3luY0RyYWluU2NoZWR1bGVkID0gZmFsc2VcbiAgdGhpcy5maWxlID0gbnVsbFxuICB0aGlzLmRlc3Ryb3llZCA9IGZhbHNlXG4gIHRoaXMuc3luYyA9IHN5bmMgfHwgZmFsc2VcblxuICB0aGlzLm1pbkxlbmd0aCA9IG1pbkxlbmd0aCB8fCAwXG5cbiAgaWYgKHR5cGVvZiBmZCA9PT0gJ251bWJlcicpIHtcbiAgICB0aGlzLmZkID0gZmRcbiAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHRoaXMuZW1pdCgncmVhZHknKSlcbiAgfSBlbHNlIGlmICh0eXBlb2YgZmQgPT09ICdzdHJpbmcnKSB7XG4gICAgb3BlbkZpbGUoZmQsIHRoaXMpXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdTb25pY0Jvb20gc3VwcG9ydHMgb25seSBmaWxlIGRlc2NyaXB0b3JzIGFuZCBmaWxlcycpXG4gIH1cblxuICB0aGlzLnJlbGVhc2UgPSAoZXJyLCBuKSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgaWYgKGVyci5jb2RlID09PSAnRUFHQUlOJykge1xuICAgICAgICAvLyBMZXQncyBnaXZlIHRoZSBkZXN0aW5hdGlvbiBzb21lIHRpbWUgdG8gcHJvY2VzcyB0aGUgY2h1bmsuXG4gICAgICAgIC8vIFRoaXMgZXJyb3IgY29kZSBzaG91bGQgbm90IGhhcHBlbiBpbiBzeW5jIG1vZGUsIGJlY2F1c2UgaXQgaXNcbiAgICAgICAgLy8gbm90IHVzaW5nIHRoZSB1bmRlcmxpbmluZyBvcGVyYXRpbmcgc3lzdGVtIGFzeW5jaHJvbm91cyBmdW5jdGlvbnMuXG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIGZzLndyaXRlKHRoaXMuZmQsIHRoaXMuX3dyaXRpbmdCdWYsICd1dGY4JywgdGhpcy5yZWxlYXNlKVxuICAgICAgICB9LCAxMDApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3dyaXRpbmdCdWYubGVuZ3RoICE9PSBuKSB7XG4gICAgICB0aGlzLl93cml0aW5nQnVmID0gdGhpcy5fd3JpdGluZ0J1Zi5zbGljZShuKVxuICAgICAgaWYgKHRoaXMuc3luYykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgIG4gPSBmcy53cml0ZVN5bmModGhpcy5mZCwgdGhpcy5fd3JpdGluZ0J1ZiwgJ3V0ZjgnKVxuICAgICAgICAgICAgdGhpcy5fd3JpdGluZ0J1ZiA9IHRoaXMuX3dyaXRpbmdCdWYuc2xpY2UobilcbiAgICAgICAgICB9IHdoaWxlICh0aGlzLl93cml0aW5nQnVmLmxlbmd0aCAhPT0gMClcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgdGhpcy5yZWxlYXNlKGVycilcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnMud3JpdGUodGhpcy5mZCwgdGhpcy5fd3JpdGluZ0J1ZiwgJ3V0ZjgnLCB0aGlzLnJlbGVhc2UpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX3dyaXRpbmdCdWYgPSAnJ1xuXG4gICAgaWYgKHRoaXMuZGVzdHJveWVkKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB2YXIgbGVuID0gdGhpcy5fYnVmLmxlbmd0aFxuICAgIGlmICh0aGlzLl9yZW9wZW5pbmcpIHtcbiAgICAgIHRoaXMuX3dyaXRpbmcgPSBmYWxzZVxuICAgICAgdGhpcy5fcmVvcGVuaW5nID0gZmFsc2VcbiAgICAgIHRoaXMucmVvcGVuKClcbiAgICB9IGVsc2UgaWYgKGxlbiA+IDAgJiYgbGVuID4gdGhpcy5taW5MZW5ndGgpIHtcbiAgICAgIGFjdHVhbFdyaXRlKHRoaXMpXG4gICAgfSBlbHNlIGlmICh0aGlzLl9lbmRpbmcpIHtcbiAgICAgIGlmIChsZW4gPiAwKSB7XG4gICAgICAgIGFjdHVhbFdyaXRlKHRoaXMpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl93cml0aW5nID0gZmFsc2VcbiAgICAgICAgYWN0dWFsQ2xvc2UodGhpcylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fd3JpdGluZyA9IGZhbHNlXG4gICAgICBpZiAodGhpcy5zeW5jKSB7XG4gICAgICAgIGlmICghdGhpcy5fYXN5bmNEcmFpblNjaGVkdWxlZCkge1xuICAgICAgICAgIHRoaXMuX2FzeW5jRHJhaW5TY2hlZHVsZWQgPSB0cnVlXG4gICAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhlbWl0RHJhaW4sIHRoaXMpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZW1pdCgnZHJhaW4nKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBlbWl0RHJhaW4gKHNvbmljKSB7XG4gIHNvbmljLl9hc3luY0RyYWluU2NoZWR1bGVkID0gZmFsc2VcbiAgc29uaWMuZW1pdCgnZHJhaW4nKVxufVxuXG5pbmhlcml0cyhTb25pY0Jvb20sIEV2ZW50RW1pdHRlcilcblxuU29uaWNCb29tLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gIGlmICh0aGlzLmRlc3Ryb3llZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignU29uaWNCb29tIGRlc3Ryb3llZCcpXG4gIH1cblxuICB0aGlzLl9idWYgKz0gZGF0YVxuICB2YXIgbGVuID0gdGhpcy5fYnVmLmxlbmd0aFxuICBpZiAoIXRoaXMuX3dyaXRpbmcgJiYgbGVuID4gdGhpcy5taW5MZW5ndGgpIHtcbiAgICBhY3R1YWxXcml0ZSh0aGlzKVxuICB9XG4gIHJldHVybiBsZW4gPCAxNjM4NFxufVxuXG5Tb25pY0Jvb20ucHJvdG90eXBlLmZsdXNoID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5kZXN0cm95ZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NvbmljQm9vbSBkZXN0cm95ZWQnKVxuICB9XG5cbiAgaWYgKHRoaXMuX3dyaXRpbmcgfHwgdGhpcy5taW5MZW5ndGggPD0gMCkge1xuICAgIHJldHVyblxuICB9XG5cbiAgYWN0dWFsV3JpdGUodGhpcylcbn1cblxuU29uaWNCb29tLnByb3RvdHlwZS5yZW9wZW4gPSBmdW5jdGlvbiAoZmlsZSkge1xuICBpZiAodGhpcy5kZXN0cm95ZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NvbmljQm9vbSBkZXN0cm95ZWQnKVxuICB9XG5cbiAgaWYgKHRoaXMuX29wZW5pbmcpIHtcbiAgICB0aGlzLm9uY2UoJ3JlYWR5JywgKCkgPT4ge1xuICAgICAgdGhpcy5yZW9wZW4oZmlsZSlcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKHRoaXMuX2VuZGluZykge1xuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCF0aGlzLmZpbGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byByZW9wZW4gYSBmaWxlIGRlc2NyaXB0b3IsIHlvdSBtdXN0IHBhc3MgYSBmaWxlIHRvIFNvbmljQm9vbScpXG4gIH1cblxuICB0aGlzLl9yZW9wZW5pbmcgPSB0cnVlXG5cbiAgaWYgKHRoaXMuX3dyaXRpbmcpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIGZzLmNsb3NlKHRoaXMuZmQsIChlcnIpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGVycilcbiAgICB9XG4gIH0pXG5cbiAgb3BlbkZpbGUoZmlsZSB8fCB0aGlzLmZpbGUsIHRoaXMpXG59XG5cblNvbmljQm9vbS5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5kZXN0cm95ZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NvbmljQm9vbSBkZXN0cm95ZWQnKVxuICB9XG5cbiAgaWYgKHRoaXMuX29wZW5pbmcpIHtcbiAgICB0aGlzLm9uY2UoJ3JlYWR5JywgKCkgPT4ge1xuICAgICAgdGhpcy5lbmQoKVxuICAgIH0pXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAodGhpcy5fZW5kaW5nKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICB0aGlzLl9lbmRpbmcgPSB0cnVlXG5cbiAgaWYgKCF0aGlzLl93cml0aW5nICYmIHRoaXMuX2J1Zi5sZW5ndGggPiAwICYmIHRoaXMuZmQgPj0gMCkge1xuICAgIGFjdHVhbFdyaXRlKHRoaXMpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAodGhpcy5fd3JpdGluZykge1xuICAgIHJldHVyblxuICB9XG5cbiAgYWN0dWFsQ2xvc2UodGhpcylcbn1cblxuU29uaWNCb29tLnByb3RvdHlwZS5mbHVzaFN5bmMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmRlc3Ryb3llZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignU29uaWNCb29tIGRlc3Ryb3llZCcpXG4gIH1cblxuICBpZiAodGhpcy5mZCA8IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NvbmljIGJvb20gaXMgbm90IHJlYWR5IHlldCcpXG4gIH1cblxuICBpZiAodGhpcy5fYnVmLmxlbmd0aCA+IDApIHtcbiAgICBmcy53cml0ZVN5bmModGhpcy5mZCwgdGhpcy5fYnVmLCAndXRmOCcpXG4gICAgdGhpcy5fYnVmID0gJydcbiAgfVxufVxuXG5Tb25pY0Jvb20ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLmRlc3Ryb3llZCkge1xuICAgIHJldHVyblxuICB9XG4gIGFjdHVhbENsb3NlKHRoaXMpXG59XG5cbmZ1bmN0aW9uIGFjdHVhbFdyaXRlIChzb25pYykge1xuICBzb25pYy5fd3JpdGluZyA9IHRydWVcbiAgdmFyIGJ1ZiA9IHNvbmljLl9idWZcbiAgdmFyIHJlbGVhc2UgPSBzb25pYy5yZWxlYXNlXG4gIGlmIChidWYubGVuZ3RoID4gTUFYX1dSSVRFKSB7XG4gICAgYnVmID0gYnVmLnNsaWNlKDAsIE1BWF9XUklURSlcbiAgICBzb25pYy5fYnVmID0gc29uaWMuX2J1Zi5zbGljZShNQVhfV1JJVEUpXG4gIH0gZWxzZSB7XG4gICAgc29uaWMuX2J1ZiA9ICcnXG4gIH1cbiAgZmxhdHN0cihidWYpXG4gIHNvbmljLl93cml0aW5nQnVmID0gYnVmXG4gIGlmIChzb25pYy5zeW5jKSB7XG4gICAgdHJ5IHtcbiAgICAgIHZhciB3cml0dGVuID0gZnMud3JpdGVTeW5jKHNvbmljLmZkLCBidWYsICd1dGY4JylcbiAgICAgIHJlbGVhc2UobnVsbCwgd3JpdHRlbilcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHJlbGVhc2UoZXJyKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBmcy53cml0ZShzb25pYy5mZCwgYnVmLCAndXRmOCcsIHJlbGVhc2UpXG4gIH1cbn1cblxuZnVuY3Rpb24gYWN0dWFsQ2xvc2UgKHNvbmljKSB7XG4gIGlmIChzb25pYy5mZCA9PT0gLTEpIHtcbiAgICBzb25pYy5vbmNlKCdyZWFkeScsIGFjdHVhbENsb3NlLmJpbmQobnVsbCwgc29uaWMpKVxuICAgIHJldHVyblxuICB9XG4gIC8vIFRPRE8gd3JpdGUgYSB0ZXN0IHRvIGNoZWNrIGlmIHdlIGFyZSBub3QgbGVha2luZyBmZHNcbiAgZnMuY2xvc2Uoc29uaWMuZmQsIChlcnIpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBzb25pYy5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChzb25pYy5fZW5kaW5nICYmICFzb25pYy5fd3JpdGluZykge1xuICAgICAgc29uaWMuZW1pdCgnZmluaXNoJylcbiAgICB9XG4gICAgc29uaWMuZW1pdCgnY2xvc2UnKVxuICB9KVxuICBzb25pYy5kZXN0cm95ZWQgPSB0cnVlXG4gIHNvbmljLl9idWYgPSAnJ1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvbmljQm9vbVxuIiwiJ3VzZSBzdHJpY3QnXG5jb25zdCBmbGF0c3RyID0gcmVxdWlyZSgnZmxhdHN0cicpXG5jb25zdCB7IGxzQ2FjaGVTeW0sIGxldmVsVmFsU3ltLCB1c2VMZXZlbExhYmVsc1N5bSwgY2hhbmdlTGV2ZWxOYW1lU3ltLCB1c2VPbmx5Q3VzdG9tTGV2ZWxzU3ltIH0gPSByZXF1aXJlKCcuL3N5bWJvbHMnKVxuY29uc3QgeyBub29wLCBnZW5Mb2cgfSA9IHJlcXVpcmUoJy4vdG9vbHMnKVxuXG5jb25zdCBsZXZlbHMgPSB7XG4gIHRyYWNlOiAxMCxcbiAgZGVidWc6IDIwLFxuICBpbmZvOiAzMCxcbiAgd2FybjogNDAsXG4gIGVycm9yOiA1MCxcbiAgZmF0YWw6IDYwXG59XG5cbmNvbnN0IGxldmVsTWV0aG9kcyA9IHtcbiAgZmF0YWw6IGdlbkxvZyhsZXZlbHMuZmF0YWwpLFxuICBlcnJvcjogZ2VuTG9nKGxldmVscy5lcnJvciksXG4gIHdhcm46IGdlbkxvZyhsZXZlbHMud2FybiksXG4gIGluZm86IGdlbkxvZyhsZXZlbHMuaW5mbyksXG4gIGRlYnVnOiBnZW5Mb2cobGV2ZWxzLmRlYnVnKSxcbiAgdHJhY2U6IGdlbkxvZyhsZXZlbHMudHJhY2UpXG59XG5cbmNvbnN0IG51bXMgPSBPYmplY3Qua2V5cyhsZXZlbHMpLnJlZHVjZSgobywgaykgPT4ge1xuICBvW2xldmVsc1trXV0gPSBrXG4gIHJldHVybiBvXG59LCB7fSlcblxuY29uc3QgaW5pdGlhbExzQ2FjaGUgPSBPYmplY3Qua2V5cyhudW1zKS5yZWR1Y2UoKG8sIGspID0+IHtcbiAgb1trXSA9IGZsYXRzdHIoJ3tcImxldmVsXCI6JyArIE51bWJlcihrKSlcbiAgcmV0dXJuIG9cbn0sIHt9KVxuXG5mdW5jdGlvbiBnZW5Mc0NhY2hlIChpbnN0YW5jZSkge1xuICBjb25zdCBsZXZlbE5hbWUgPSBpbnN0YW5jZVtjaGFuZ2VMZXZlbE5hbWVTeW1dXG4gIGluc3RhbmNlW2xzQ2FjaGVTeW1dID0gT2JqZWN0LmtleXMoaW5zdGFuY2UubGV2ZWxzLmxhYmVscykucmVkdWNlKChvLCBrKSA9PiB7XG4gICAgb1trXSA9IGluc3RhbmNlW3VzZUxldmVsTGFiZWxzU3ltXVxuICAgICAgPyBge1wiJHtsZXZlbE5hbWV9XCI6XCIke2luc3RhbmNlLmxldmVscy5sYWJlbHNba119XCJgXG4gICAgICA6IGZsYXRzdHIoYHtcIiR7bGV2ZWxOYW1lfVwiOmAgKyBOdW1iZXIoaykpXG4gICAgcmV0dXJuIG9cbiAgfSwgaW5zdGFuY2VbbHNDYWNoZVN5bV0pXG4gIHJldHVybiBpbnN0YW5jZVxufVxuXG5mdW5jdGlvbiBpc1N0YW5kYXJkTGV2ZWwgKGxldmVsLCB1c2VPbmx5Q3VzdG9tTGV2ZWxzKSB7XG4gIGlmICh1c2VPbmx5Q3VzdG9tTGV2ZWxzKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBzd2l0Y2ggKGxldmVsKSB7XG4gICAgY2FzZSAnZmF0YWwnOlxuICAgIGNhc2UgJ2Vycm9yJzpcbiAgICBjYXNlICd3YXJuJzpcbiAgICBjYXNlICdpbmZvJzpcbiAgICBjYXNlICdkZWJ1Zyc6XG4gICAgY2FzZSAndHJhY2UnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuZnVuY3Rpb24gc2V0TGV2ZWwgKGxldmVsKSB7XG4gIGNvbnN0IHsgbGFiZWxzLCB2YWx1ZXMgfSA9IHRoaXMubGV2ZWxzXG4gIGlmICh0eXBlb2YgbGV2ZWwgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKGxhYmVsc1tsZXZlbF0gPT09IHVuZGVmaW5lZCkgdGhyb3cgRXJyb3IoJ3Vua25vd24gbGV2ZWwgdmFsdWUnICsgbGV2ZWwpXG4gICAgbGV2ZWwgPSBsYWJlbHNbbGV2ZWxdXG4gIH1cbiAgaWYgKHZhbHVlc1tsZXZlbF0gPT09IHVuZGVmaW5lZCkgdGhyb3cgRXJyb3IoJ3Vua25vd24gbGV2ZWwgJyArIGxldmVsKVxuICBjb25zdCBwcmVMZXZlbFZhbCA9IHRoaXNbbGV2ZWxWYWxTeW1dXG4gIGNvbnN0IGxldmVsVmFsID0gdGhpc1tsZXZlbFZhbFN5bV0gPSB2YWx1ZXNbbGV2ZWxdXG4gIGNvbnN0IHVzZU9ubHlDdXN0b21MZXZlbHNWYWwgPSB0aGlzW3VzZU9ubHlDdXN0b21MZXZlbHNTeW1dXG5cbiAgZm9yICh2YXIga2V5IGluIHZhbHVlcykge1xuICAgIGlmIChsZXZlbFZhbCA+IHZhbHVlc1trZXldKSB7XG4gICAgICB0aGlzW2tleV0gPSBub29wXG4gICAgICBjb250aW51ZVxuICAgIH1cbiAgICB0aGlzW2tleV0gPSBpc1N0YW5kYXJkTGV2ZWwoa2V5LCB1c2VPbmx5Q3VzdG9tTGV2ZWxzVmFsKSA/IGxldmVsTWV0aG9kc1trZXldIDogZ2VuTG9nKHZhbHVlc1trZXldKVxuICB9XG5cbiAgdGhpcy5lbWl0KFxuICAgICdsZXZlbC1jaGFuZ2UnLFxuICAgIGxldmVsLFxuICAgIGxldmVsVmFsLFxuICAgIGxhYmVsc1twcmVMZXZlbFZhbF0sXG4gICAgcHJlTGV2ZWxWYWxcbiAgKVxufVxuXG5mdW5jdGlvbiBnZXRMZXZlbCAobGV2ZWwpIHtcbiAgY29uc3QgeyBsZXZlbHMsIGxldmVsVmFsIH0gPSB0aGlzXG4gIHJldHVybiBsZXZlbHMubGFiZWxzW2xldmVsVmFsXVxufVxuXG5mdW5jdGlvbiBpc0xldmVsRW5hYmxlZCAobG9nTGV2ZWwpIHtcbiAgY29uc3QgeyB2YWx1ZXMgfSA9IHRoaXMubGV2ZWxzXG4gIGNvbnN0IGxvZ0xldmVsVmFsID0gdmFsdWVzW2xvZ0xldmVsXVxuICByZXR1cm4gbG9nTGV2ZWxWYWwgIT09IHVuZGVmaW5lZCAmJiAobG9nTGV2ZWxWYWwgPj0gdGhpc1tsZXZlbFZhbFN5bV0pXG59XG5cbmZ1bmN0aW9uIG1hcHBpbmdzIChjdXN0b21MZXZlbHMgPSBudWxsLCB1c2VPbmx5Q3VzdG9tTGV2ZWxzID0gZmFsc2UpIHtcbiAgY29uc3QgY3VzdG9tTnVtcyA9IGN1c3RvbUxldmVscyA/IE9iamVjdC5rZXlzKGN1c3RvbUxldmVscykucmVkdWNlKChvLCBrKSA9PiB7XG4gICAgb1tjdXN0b21MZXZlbHNba11dID0ga1xuICAgIHJldHVybiBvXG4gIH0sIHt9KSA6IG51bGxcblxuICBjb25zdCBsYWJlbHMgPSBPYmplY3QuYXNzaWduKFxuICAgIE9iamVjdC5jcmVhdGUoT2JqZWN0LnByb3RvdHlwZSwgeyBJbmZpbml0eTogeyB2YWx1ZTogJ3NpbGVudCcgfSB9KSxcbiAgICB1c2VPbmx5Q3VzdG9tTGV2ZWxzID8gbnVsbCA6IG51bXMsXG4gICAgY3VzdG9tTnVtc1xuICApXG4gIGNvbnN0IHZhbHVlcyA9IE9iamVjdC5hc3NpZ24oXG4gICAgT2JqZWN0LmNyZWF0ZShPYmplY3QucHJvdG90eXBlLCB7IHNpbGVudDogeyB2YWx1ZTogSW5maW5pdHkgfSB9KSxcbiAgICB1c2VPbmx5Q3VzdG9tTGV2ZWxzID8gbnVsbCA6IGxldmVscyxcbiAgICBjdXN0b21MZXZlbHNcbiAgKVxuICByZXR1cm4geyBsYWJlbHMsIHZhbHVlcyB9XG59XG5cbmZ1bmN0aW9uIGFzc2VydERlZmF1bHRMZXZlbEZvdW5kIChkZWZhdWx0TGV2ZWwsIGN1c3RvbUxldmVscywgdXNlT25seUN1c3RvbUxldmVscykge1xuICBpZiAodHlwZW9mIGRlZmF1bHRMZXZlbCA9PT0gJ251bWJlcicpIHtcbiAgICBjb25zdCB2YWx1ZXMgPSBbXS5jb25jYXQoXG4gICAgICBPYmplY3Qua2V5cyhjdXN0b21MZXZlbHMgfHwge30pLm1hcChrZXkgPT4gY3VzdG9tTGV2ZWxzW2tleV0pLFxuICAgICAgdXNlT25seUN1c3RvbUxldmVscyA/IFtdIDogT2JqZWN0LmtleXMobnVtcykubWFwKGxldmVsID0+ICtsZXZlbCksXG4gICAgICBJbmZpbml0eVxuICAgIClcbiAgICBpZiAoIXZhbHVlcy5pbmNsdWRlcyhkZWZhdWx0TGV2ZWwpKSB7XG4gICAgICB0aHJvdyBFcnJvcihgZGVmYXVsdCBsZXZlbDoke2RlZmF1bHRMZXZlbH0gbXVzdCBiZSBpbmNsdWRlZCBpbiBjdXN0b20gbGV2ZWxzYClcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBsYWJlbHMgPSBPYmplY3QuYXNzaWduKFxuICAgIE9iamVjdC5jcmVhdGUoT2JqZWN0LnByb3RvdHlwZSwgeyBzaWxlbnQ6IHsgdmFsdWU6IEluZmluaXR5IH0gfSksXG4gICAgdXNlT25seUN1c3RvbUxldmVscyA/IG51bGwgOiBsZXZlbHMsXG4gICAgY3VzdG9tTGV2ZWxzXG4gIClcbiAgaWYgKCEoZGVmYXVsdExldmVsIGluIGxhYmVscykpIHtcbiAgICB0aHJvdyBFcnJvcihgZGVmYXVsdCBsZXZlbDoke2RlZmF1bHRMZXZlbH0gbXVzdCBiZSBpbmNsdWRlZCBpbiBjdXN0b20gbGV2ZWxzYClcbiAgfVxufVxuXG5mdW5jdGlvbiBhc3NlcnROb0xldmVsQ29sbGlzaW9ucyAobGV2ZWxzLCBjdXN0b21MZXZlbHMpIHtcbiAgY29uc3QgeyBsYWJlbHMsIHZhbHVlcyB9ID0gbGV2ZWxzXG4gIGZvciAoY29uc3QgayBpbiBjdXN0b21MZXZlbHMpIHtcbiAgICBpZiAoayBpbiB2YWx1ZXMpIHtcbiAgICAgIHRocm93IEVycm9yKCdsZXZlbHMgY2Fubm90IGJlIG92ZXJyaWRkZW4nKVxuICAgIH1cbiAgICBpZiAoY3VzdG9tTGV2ZWxzW2tdIGluIGxhYmVscykge1xuICAgICAgdGhyb3cgRXJyb3IoJ3ByZS1leGlzdGluZyBsZXZlbCB2YWx1ZXMgY2Fubm90IGJlIHVzZWQgZm9yIG5ldyBsZXZlbHMnKVxuICAgIH1cbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgaW5pdGlhbExzQ2FjaGUsXG4gIGdlbkxzQ2FjaGUsXG4gIGxldmVsTWV0aG9kcyxcbiAgZ2V0TGV2ZWwsXG4gIHNldExldmVsLFxuICBpc0xldmVsRW5hYmxlZCxcbiAgbWFwcGluZ3MsXG4gIGFzc2VydE5vTGV2ZWxDb2xsaXNpb25zLFxuICBhc3NlcnREZWZhdWx0TGV2ZWxGb3VuZFxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBzdHJpbmdpZnlcbnN0cmluZ2lmeS5kZWZhdWx0ID0gc3RyaW5naWZ5XG5zdHJpbmdpZnkuc3RhYmxlID0gZGV0ZXJtaW5pc3RpY1N0cmluZ2lmeVxuc3RyaW5naWZ5LnN0YWJsZVN0cmluZ2lmeSA9IGRldGVybWluaXN0aWNTdHJpbmdpZnlcblxudmFyIGFyciA9IFtdXG52YXIgcmVwbGFjZXJTdGFjayA9IFtdXG5cbi8vIFJlZ3VsYXIgc3RyaW5naWZ5XG5mdW5jdGlvbiBzdHJpbmdpZnkgKG9iaiwgcmVwbGFjZXIsIHNwYWNlcikge1xuICBkZWNpcmMob2JqLCAnJywgW10sIHVuZGVmaW5lZClcbiAgdmFyIHJlc1xuICBpZiAocmVwbGFjZXJTdGFjay5sZW5ndGggPT09IDApIHtcbiAgICByZXMgPSBKU09OLnN0cmluZ2lmeShvYmosIHJlcGxhY2VyLCBzcGFjZXIpXG4gIH0gZWxzZSB7XG4gICAgcmVzID0gSlNPTi5zdHJpbmdpZnkob2JqLCByZXBsYWNlR2V0dGVyVmFsdWVzKHJlcGxhY2VyKSwgc3BhY2VyKVxuICB9XG4gIHdoaWxlIChhcnIubGVuZ3RoICE9PSAwKSB7XG4gICAgdmFyIHBhcnQgPSBhcnIucG9wKClcbiAgICBpZiAocGFydC5sZW5ndGggPT09IDQpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwYXJ0WzBdLCBwYXJ0WzFdLCBwYXJ0WzNdKVxuICAgIH0gZWxzZSB7XG4gICAgICBwYXJ0WzBdW3BhcnRbMV1dID0gcGFydFsyXVxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzXG59XG5mdW5jdGlvbiBkZWNpcmMgKHZhbCwgaywgc3RhY2ssIHBhcmVudCkge1xuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgJiYgdmFsICE9PSBudWxsKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IHN0YWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoc3RhY2tbaV0gPT09IHZhbCkge1xuICAgICAgICB2YXIgcHJvcGVydHlEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwYXJlbnQsIGspXG4gICAgICAgIGlmIChwcm9wZXJ0eURlc2NyaXB0b3IuZ2V0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAocHJvcGVydHlEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHBhcmVudCwgaywgeyB2YWx1ZTogJ1tDaXJjdWxhcl0nIH0pXG4gICAgICAgICAgICBhcnIucHVzaChbcGFyZW50LCBrLCB2YWwsIHByb3BlcnR5RGVzY3JpcHRvcl0pXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcGxhY2VyU3RhY2sucHVzaChbdmFsLCBrXSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcGFyZW50W2tdID0gJ1tDaXJjdWxhcl0nXG4gICAgICAgICAgYXJyLnB1c2goW3BhcmVudCwgaywgdmFsXSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG4gICAgc3RhY2sucHVzaCh2YWwpXG4gICAgLy8gT3B0aW1pemUgZm9yIEFycmF5cy4gQmlnIGFycmF5cyBjb3VsZCBraWxsIHRoZSBwZXJmb3JtYW5jZSBvdGhlcndpc2UhXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IHZhbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBkZWNpcmModmFsW2ldLCBpLCBzdGFjaywgdmFsKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHZhbClcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldXG4gICAgICAgIGRlY2lyYyh2YWxba2V5XSwga2V5LCBzdGFjaywgdmFsKVxuICAgICAgfVxuICAgIH1cbiAgICBzdGFjay5wb3AoKVxuICB9XG59XG5cbi8vIFN0YWJsZS1zdHJpbmdpZnlcbmZ1bmN0aW9uIGNvbXBhcmVGdW5jdGlvbiAoYSwgYikge1xuICBpZiAoYSA8IGIpIHtcbiAgICByZXR1cm4gLTFcbiAgfVxuICBpZiAoYSA+IGIpIHtcbiAgICByZXR1cm4gMVxuICB9XG4gIHJldHVybiAwXG59XG5cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNTdHJpbmdpZnkgKG9iaiwgcmVwbGFjZXIsIHNwYWNlcikge1xuICB2YXIgdG1wID0gZGV0ZXJtaW5pc3RpY0RlY2lyYyhvYmosICcnLCBbXSwgdW5kZWZpbmVkKSB8fCBvYmpcbiAgdmFyIHJlc1xuICBpZiAocmVwbGFjZXJTdGFjay5sZW5ndGggPT09IDApIHtcbiAgICByZXMgPSBKU09OLnN0cmluZ2lmeSh0bXAsIHJlcGxhY2VyLCBzcGFjZXIpXG4gIH0gZWxzZSB7XG4gICAgcmVzID0gSlNPTi5zdHJpbmdpZnkodG1wLCByZXBsYWNlR2V0dGVyVmFsdWVzKHJlcGxhY2VyKSwgc3BhY2VyKVxuICB9XG4gIHdoaWxlIChhcnIubGVuZ3RoICE9PSAwKSB7XG4gICAgdmFyIHBhcnQgPSBhcnIucG9wKClcbiAgICBpZiAocGFydC5sZW5ndGggPT09IDQpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwYXJ0WzBdLCBwYXJ0WzFdLCBwYXJ0WzNdKVxuICAgIH0gZWxzZSB7XG4gICAgICBwYXJ0WzBdW3BhcnRbMV1dID0gcGFydFsyXVxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNEZWNpcmMgKHZhbCwgaywgc3RhY2ssIHBhcmVudCkge1xuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgJiYgdmFsICE9PSBudWxsKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IHN0YWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoc3RhY2tbaV0gPT09IHZhbCkge1xuICAgICAgICB2YXIgcHJvcGVydHlEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwYXJlbnQsIGspXG4gICAgICAgIGlmIChwcm9wZXJ0eURlc2NyaXB0b3IuZ2V0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAocHJvcGVydHlEZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHBhcmVudCwgaywgeyB2YWx1ZTogJ1tDaXJjdWxhcl0nIH0pXG4gICAgICAgICAgICBhcnIucHVzaChbcGFyZW50LCBrLCB2YWwsIHByb3BlcnR5RGVzY3JpcHRvcl0pXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcGxhY2VyU3RhY2sucHVzaChbdmFsLCBrXSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcGFyZW50W2tdID0gJ1tDaXJjdWxhcl0nXG4gICAgICAgICAgYXJyLnB1c2goW3BhcmVudCwgaywgdmFsXSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHR5cGVvZiB2YWwudG9KU09OID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgc3RhY2sucHVzaCh2YWwpXG4gICAgLy8gT3B0aW1pemUgZm9yIEFycmF5cy4gQmlnIGFycmF5cyBjb3VsZCBraWxsIHRoZSBwZXJmb3JtYW5jZSBvdGhlcndpc2UhXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IHZhbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBkZXRlcm1pbmlzdGljRGVjaXJjKHZhbFtpXSwgaSwgc3RhY2ssIHZhbClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IG9iamVjdCBpbiB0aGUgcmVxdWlyZWQgd2F5XG4gICAgICB2YXIgdG1wID0ge31cbiAgICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXModmFsKS5zb3J0KGNvbXBhcmVGdW5jdGlvbilcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldXG4gICAgICAgIGRldGVybWluaXN0aWNEZWNpcmModmFsW2tleV0sIGtleSwgc3RhY2ssIHZhbClcbiAgICAgICAgdG1wW2tleV0gPSB2YWxba2V5XVxuICAgICAgfVxuICAgICAgaWYgKHBhcmVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGFyci5wdXNoKFtwYXJlbnQsIGssIHZhbF0pXG4gICAgICAgIHBhcmVudFtrXSA9IHRtcFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHRtcFxuICAgICAgfVxuICAgIH1cbiAgICBzdGFjay5wb3AoKVxuICB9XG59XG5cbi8vIHdyYXBzIHJlcGxhY2VyIGZ1bmN0aW9uIHRvIGhhbmRsZSB2YWx1ZXMgd2UgY291bGRuJ3QgcmVwbGFjZVxuLy8gYW5kIG1hcmsgdGhlbSBhcyBbQ2lyY3VsYXJdXG5mdW5jdGlvbiByZXBsYWNlR2V0dGVyVmFsdWVzIChyZXBsYWNlcikge1xuICByZXBsYWNlciA9IHJlcGxhY2VyICE9PSB1bmRlZmluZWQgPyByZXBsYWNlciA6IGZ1bmN0aW9uIChrLCB2KSB7IHJldHVybiB2IH1cbiAgcmV0dXJuIGZ1bmN0aW9uIChrZXksIHZhbCkge1xuICAgIGlmIChyZXBsYWNlclN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVwbGFjZXJTdGFjay5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgcGFydCA9IHJlcGxhY2VyU3RhY2tbaV1cbiAgICAgICAgaWYgKHBhcnRbMV0gPT09IGtleSAmJiBwYXJ0WzBdID09PSB2YWwpIHtcbiAgICAgICAgICB2YWwgPSAnW0NpcmN1bGFyXSdcbiAgICAgICAgICByZXBsYWNlclN0YWNrLnNwbGljZShpLCAxKVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlcGxhY2VyLmNhbGwodGhpcywga2V5LCB2YWwpXG4gIH1cbn1cbiIsIi8qIE1JVCBsaWNlbnNlICovXG52YXIgY3NzS2V5d29yZHMgPSByZXF1aXJlKCdjb2xvci1uYW1lJyk7XG5cbi8vIE5PVEU6IGNvbnZlcnNpb25zIHNob3VsZCBvbmx5IHJldHVybiBwcmltaXRpdmUgdmFsdWVzIChpLmUuIGFycmF5cywgb3Jcbi8vICAgICAgIHZhbHVlcyB0aGF0IGdpdmUgY29ycmVjdCBgdHlwZW9mYCByZXN1bHRzKS5cbi8vICAgICAgIGRvIG5vdCB1c2UgYm94IHZhbHVlcyB0eXBlcyAoaS5lLiBOdW1iZXIoKSwgU3RyaW5nKCksIGV0Yy4pXG5cbnZhciByZXZlcnNlS2V5d29yZHMgPSB7fTtcbmZvciAodmFyIGtleSBpbiBjc3NLZXl3b3Jkcykge1xuXHRpZiAoY3NzS2V5d29yZHMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuXHRcdHJldmVyc2VLZXl3b3Jkc1tjc3NLZXl3b3Jkc1trZXldXSA9IGtleTtcblx0fVxufVxuXG52YXIgY29udmVydCA9IG1vZHVsZS5leHBvcnRzID0ge1xuXHRyZ2I6IHtjaGFubmVsczogMywgbGFiZWxzOiAncmdiJ30sXG5cdGhzbDoge2NoYW5uZWxzOiAzLCBsYWJlbHM6ICdoc2wnfSxcblx0aHN2OiB7Y2hhbm5lbHM6IDMsIGxhYmVsczogJ2hzdid9LFxuXHRod2I6IHtjaGFubmVsczogMywgbGFiZWxzOiAnaHdiJ30sXG5cdGNteWs6IHtjaGFubmVsczogNCwgbGFiZWxzOiAnY215ayd9LFxuXHR4eXo6IHtjaGFubmVsczogMywgbGFiZWxzOiAneHl6J30sXG5cdGxhYjoge2NoYW5uZWxzOiAzLCBsYWJlbHM6ICdsYWInfSxcblx0bGNoOiB7Y2hhbm5lbHM6IDMsIGxhYmVsczogJ2xjaCd9LFxuXHRoZXg6IHtjaGFubmVsczogMSwgbGFiZWxzOiBbJ2hleCddfSxcblx0a2V5d29yZDoge2NoYW5uZWxzOiAxLCBsYWJlbHM6IFsna2V5d29yZCddfSxcblx0YW5zaTE2OiB7Y2hhbm5lbHM6IDEsIGxhYmVsczogWydhbnNpMTYnXX0sXG5cdGFuc2kyNTY6IHtjaGFubmVsczogMSwgbGFiZWxzOiBbJ2Fuc2kyNTYnXX0sXG5cdGhjZzoge2NoYW5uZWxzOiAzLCBsYWJlbHM6IFsnaCcsICdjJywgJ2cnXX0sXG5cdGFwcGxlOiB7Y2hhbm5lbHM6IDMsIGxhYmVsczogWydyMTYnLCAnZzE2JywgJ2IxNiddfSxcblx0Z3JheToge2NoYW5uZWxzOiAxLCBsYWJlbHM6IFsnZ3JheSddfVxufTtcblxuLy8gaGlkZSAuY2hhbm5lbHMgYW5kIC5sYWJlbHMgcHJvcGVydGllc1xuZm9yICh2YXIgbW9kZWwgaW4gY29udmVydCkge1xuXHRpZiAoY29udmVydC5oYXNPd25Qcm9wZXJ0eShtb2RlbCkpIHtcblx0XHRpZiAoISgnY2hhbm5lbHMnIGluIGNvbnZlcnRbbW9kZWxdKSkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdtaXNzaW5nIGNoYW5uZWxzIHByb3BlcnR5OiAnICsgbW9kZWwpO1xuXHRcdH1cblxuXHRcdGlmICghKCdsYWJlbHMnIGluIGNvbnZlcnRbbW9kZWxdKSkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdtaXNzaW5nIGNoYW5uZWwgbGFiZWxzIHByb3BlcnR5OiAnICsgbW9kZWwpO1xuXHRcdH1cblxuXHRcdGlmIChjb252ZXJ0W21vZGVsXS5sYWJlbHMubGVuZ3RoICE9PSBjb252ZXJ0W21vZGVsXS5jaGFubmVscykge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdjaGFubmVsIGFuZCBsYWJlbCBjb3VudHMgbWlzbWF0Y2g6ICcgKyBtb2RlbCk7XG5cdFx0fVxuXG5cdFx0dmFyIGNoYW5uZWxzID0gY29udmVydFttb2RlbF0uY2hhbm5lbHM7XG5cdFx0dmFyIGxhYmVscyA9IGNvbnZlcnRbbW9kZWxdLmxhYmVscztcblx0XHRkZWxldGUgY29udmVydFttb2RlbF0uY2hhbm5lbHM7XG5cdFx0ZGVsZXRlIGNvbnZlcnRbbW9kZWxdLmxhYmVscztcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoY29udmVydFttb2RlbF0sICdjaGFubmVscycsIHt2YWx1ZTogY2hhbm5lbHN9KTtcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoY29udmVydFttb2RlbF0sICdsYWJlbHMnLCB7dmFsdWU6IGxhYmVsc30pO1xuXHR9XG59XG5cbmNvbnZlcnQucmdiLmhzbCA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0dmFyIHIgPSByZ2JbMF0gLyAyNTU7XG5cdHZhciBnID0gcmdiWzFdIC8gMjU1O1xuXHR2YXIgYiA9IHJnYlsyXSAvIDI1NTtcblx0dmFyIG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuXHR2YXIgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG5cdHZhciBkZWx0YSA9IG1heCAtIG1pbjtcblx0dmFyIGg7XG5cdHZhciBzO1xuXHR2YXIgbDtcblxuXHRpZiAobWF4ID09PSBtaW4pIHtcblx0XHRoID0gMDtcblx0fSBlbHNlIGlmIChyID09PSBtYXgpIHtcblx0XHRoID0gKGcgLSBiKSAvIGRlbHRhO1xuXHR9IGVsc2UgaWYgKGcgPT09IG1heCkge1xuXHRcdGggPSAyICsgKGIgLSByKSAvIGRlbHRhO1xuXHR9IGVsc2UgaWYgKGIgPT09IG1heCkge1xuXHRcdGggPSA0ICsgKHIgLSBnKSAvIGRlbHRhO1xuXHR9XG5cblx0aCA9IE1hdGgubWluKGggKiA2MCwgMzYwKTtcblxuXHRpZiAoaCA8IDApIHtcblx0XHRoICs9IDM2MDtcblx0fVxuXG5cdGwgPSAobWluICsgbWF4KSAvIDI7XG5cblx0aWYgKG1heCA9PT0gbWluKSB7XG5cdFx0cyA9IDA7XG5cdH0gZWxzZSBpZiAobCA8PSAwLjUpIHtcblx0XHRzID0gZGVsdGEgLyAobWF4ICsgbWluKTtcblx0fSBlbHNlIHtcblx0XHRzID0gZGVsdGEgLyAoMiAtIG1heCAtIG1pbik7XG5cdH1cblxuXHRyZXR1cm4gW2gsIHMgKiAxMDAsIGwgKiAxMDBdO1xufTtcblxuY29udmVydC5yZ2IuaHN2ID0gZnVuY3Rpb24gKHJnYikge1xuXHR2YXIgcmRpZjtcblx0dmFyIGdkaWY7XG5cdHZhciBiZGlmO1xuXHR2YXIgaDtcblx0dmFyIHM7XG5cblx0dmFyIHIgPSByZ2JbMF0gLyAyNTU7XG5cdHZhciBnID0gcmdiWzFdIC8gMjU1O1xuXHR2YXIgYiA9IHJnYlsyXSAvIDI1NTtcblx0dmFyIHYgPSBNYXRoLm1heChyLCBnLCBiKTtcblx0dmFyIGRpZmYgPSB2IC0gTWF0aC5taW4ociwgZywgYik7XG5cdHZhciBkaWZmYyA9IGZ1bmN0aW9uIChjKSB7XG5cdFx0cmV0dXJuICh2IC0gYykgLyA2IC8gZGlmZiArIDEgLyAyO1xuXHR9O1xuXG5cdGlmIChkaWZmID09PSAwKSB7XG5cdFx0aCA9IHMgPSAwO1xuXHR9IGVsc2Uge1xuXHRcdHMgPSBkaWZmIC8gdjtcblx0XHRyZGlmID0gZGlmZmMocik7XG5cdFx0Z2RpZiA9IGRpZmZjKGcpO1xuXHRcdGJkaWYgPSBkaWZmYyhiKTtcblxuXHRcdGlmIChyID09PSB2KSB7XG5cdFx0XHRoID0gYmRpZiAtIGdkaWY7XG5cdFx0fSBlbHNlIGlmIChnID09PSB2KSB7XG5cdFx0XHRoID0gKDEgLyAzKSArIHJkaWYgLSBiZGlmO1xuXHRcdH0gZWxzZSBpZiAoYiA9PT0gdikge1xuXHRcdFx0aCA9ICgyIC8gMykgKyBnZGlmIC0gcmRpZjtcblx0XHR9XG5cdFx0aWYgKGggPCAwKSB7XG5cdFx0XHRoICs9IDE7XG5cdFx0fSBlbHNlIGlmIChoID4gMSkge1xuXHRcdFx0aCAtPSAxO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiBbXG5cdFx0aCAqIDM2MCxcblx0XHRzICogMTAwLFxuXHRcdHYgKiAxMDBcblx0XTtcbn07XG5cbmNvbnZlcnQucmdiLmh3YiA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0dmFyIHIgPSByZ2JbMF07XG5cdHZhciBnID0gcmdiWzFdO1xuXHR2YXIgYiA9IHJnYlsyXTtcblx0dmFyIGggPSBjb252ZXJ0LnJnYi5oc2wocmdiKVswXTtcblx0dmFyIHcgPSAxIC8gMjU1ICogTWF0aC5taW4ociwgTWF0aC5taW4oZywgYikpO1xuXG5cdGIgPSAxIC0gMSAvIDI1NSAqIE1hdGgubWF4KHIsIE1hdGgubWF4KGcsIGIpKTtcblxuXHRyZXR1cm4gW2gsIHcgKiAxMDAsIGIgKiAxMDBdO1xufTtcblxuY29udmVydC5yZ2IuY215ayA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0dmFyIHIgPSByZ2JbMF0gLyAyNTU7XG5cdHZhciBnID0gcmdiWzFdIC8gMjU1O1xuXHR2YXIgYiA9IHJnYlsyXSAvIDI1NTtcblx0dmFyIGM7XG5cdHZhciBtO1xuXHR2YXIgeTtcblx0dmFyIGs7XG5cblx0ayA9IE1hdGgubWluKDEgLSByLCAxIC0gZywgMSAtIGIpO1xuXHRjID0gKDEgLSByIC0gaykgLyAoMSAtIGspIHx8IDA7XG5cdG0gPSAoMSAtIGcgLSBrKSAvICgxIC0gaykgfHwgMDtcblx0eSA9ICgxIC0gYiAtIGspIC8gKDEgLSBrKSB8fCAwO1xuXG5cdHJldHVybiBbYyAqIDEwMCwgbSAqIDEwMCwgeSAqIDEwMCwgayAqIDEwMF07XG59O1xuXG4vKipcbiAqIFNlZSBodHRwczovL2VuLm0ud2lraXBlZGlhLm9yZy93aWtpL0V1Y2xpZGVhbl9kaXN0YW5jZSNTcXVhcmVkX0V1Y2xpZGVhbl9kaXN0YW5jZVxuICogKi9cbmZ1bmN0aW9uIGNvbXBhcmF0aXZlRGlzdGFuY2UoeCwgeSkge1xuXHRyZXR1cm4gKFxuXHRcdE1hdGgucG93KHhbMF0gLSB5WzBdLCAyKSArXG5cdFx0TWF0aC5wb3coeFsxXSAtIHlbMV0sIDIpICtcblx0XHRNYXRoLnBvdyh4WzJdIC0geVsyXSwgMilcblx0KTtcbn1cblxuY29udmVydC5yZ2Iua2V5d29yZCA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0dmFyIHJldmVyc2VkID0gcmV2ZXJzZUtleXdvcmRzW3JnYl07XG5cdGlmIChyZXZlcnNlZCkge1xuXHRcdHJldHVybiByZXZlcnNlZDtcblx0fVxuXG5cdHZhciBjdXJyZW50Q2xvc2VzdERpc3RhbmNlID0gSW5maW5pdHk7XG5cdHZhciBjdXJyZW50Q2xvc2VzdEtleXdvcmQ7XG5cblx0Zm9yICh2YXIga2V5d29yZCBpbiBjc3NLZXl3b3Jkcykge1xuXHRcdGlmIChjc3NLZXl3b3Jkcy5oYXNPd25Qcm9wZXJ0eShrZXl3b3JkKSkge1xuXHRcdFx0dmFyIHZhbHVlID0gY3NzS2V5d29yZHNba2V5d29yZF07XG5cblx0XHRcdC8vIENvbXB1dGUgY29tcGFyYXRpdmUgZGlzdGFuY2Vcblx0XHRcdHZhciBkaXN0YW5jZSA9IGNvbXBhcmF0aXZlRGlzdGFuY2UocmdiLCB2YWx1ZSk7XG5cblx0XHRcdC8vIENoZWNrIGlmIGl0cyBsZXNzLCBpZiBzbyBzZXQgYXMgY2xvc2VzdFxuXHRcdFx0aWYgKGRpc3RhbmNlIDwgY3VycmVudENsb3Nlc3REaXN0YW5jZSkge1xuXHRcdFx0XHRjdXJyZW50Q2xvc2VzdERpc3RhbmNlID0gZGlzdGFuY2U7XG5cdFx0XHRcdGN1cnJlbnRDbG9zZXN0S2V5d29yZCA9IGtleXdvcmQ7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIGN1cnJlbnRDbG9zZXN0S2V5d29yZDtcbn07XG5cbmNvbnZlcnQua2V5d29yZC5yZ2IgPSBmdW5jdGlvbiAoa2V5d29yZCkge1xuXHRyZXR1cm4gY3NzS2V5d29yZHNba2V5d29yZF07XG59O1xuXG5jb252ZXJ0LnJnYi54eXogPSBmdW5jdGlvbiAocmdiKSB7XG5cdHZhciByID0gcmdiWzBdIC8gMjU1O1xuXHR2YXIgZyA9IHJnYlsxXSAvIDI1NTtcblx0dmFyIGIgPSByZ2JbMl0gLyAyNTU7XG5cblx0Ly8gYXNzdW1lIHNSR0Jcblx0ciA9IHIgPiAwLjA0MDQ1ID8gTWF0aC5wb3coKChyICsgMC4wNTUpIC8gMS4wNTUpLCAyLjQpIDogKHIgLyAxMi45Mik7XG5cdGcgPSBnID4gMC4wNDA0NSA/IE1hdGgucG93KCgoZyArIDAuMDU1KSAvIDEuMDU1KSwgMi40KSA6IChnIC8gMTIuOTIpO1xuXHRiID0gYiA+IDAuMDQwNDUgPyBNYXRoLnBvdygoKGIgKyAwLjA1NSkgLyAxLjA1NSksIDIuNCkgOiAoYiAvIDEyLjkyKTtcblxuXHR2YXIgeCA9IChyICogMC40MTI0KSArIChnICogMC4zNTc2KSArIChiICogMC4xODA1KTtcblx0dmFyIHkgPSAociAqIDAuMjEyNikgKyAoZyAqIDAuNzE1MikgKyAoYiAqIDAuMDcyMik7XG5cdHZhciB6ID0gKHIgKiAwLjAxOTMpICsgKGcgKiAwLjExOTIpICsgKGIgKiAwLjk1MDUpO1xuXG5cdHJldHVybiBbeCAqIDEwMCwgeSAqIDEwMCwgeiAqIDEwMF07XG59O1xuXG5jb252ZXJ0LnJnYi5sYWIgPSBmdW5jdGlvbiAocmdiKSB7XG5cdHZhciB4eXogPSBjb252ZXJ0LnJnYi54eXoocmdiKTtcblx0dmFyIHggPSB4eXpbMF07XG5cdHZhciB5ID0geHl6WzFdO1xuXHR2YXIgeiA9IHh5elsyXTtcblx0dmFyIGw7XG5cdHZhciBhO1xuXHR2YXIgYjtcblxuXHR4IC89IDk1LjA0Nztcblx0eSAvPSAxMDA7XG5cdHogLz0gMTA4Ljg4MztcblxuXHR4ID0geCA+IDAuMDA4ODU2ID8gTWF0aC5wb3coeCwgMSAvIDMpIDogKDcuNzg3ICogeCkgKyAoMTYgLyAxMTYpO1xuXHR5ID0geSA+IDAuMDA4ODU2ID8gTWF0aC5wb3coeSwgMSAvIDMpIDogKDcuNzg3ICogeSkgKyAoMTYgLyAxMTYpO1xuXHR6ID0geiA+IDAuMDA4ODU2ID8gTWF0aC5wb3coeiwgMSAvIDMpIDogKDcuNzg3ICogeikgKyAoMTYgLyAxMTYpO1xuXG5cdGwgPSAoMTE2ICogeSkgLSAxNjtcblx0YSA9IDUwMCAqICh4IC0geSk7XG5cdGIgPSAyMDAgKiAoeSAtIHopO1xuXG5cdHJldHVybiBbbCwgYSwgYl07XG59O1xuXG5jb252ZXJ0LmhzbC5yZ2IgPSBmdW5jdGlvbiAoaHNsKSB7XG5cdHZhciBoID0gaHNsWzBdIC8gMzYwO1xuXHR2YXIgcyA9IGhzbFsxXSAvIDEwMDtcblx0dmFyIGwgPSBoc2xbMl0gLyAxMDA7XG5cdHZhciB0MTtcblx0dmFyIHQyO1xuXHR2YXIgdDM7XG5cdHZhciByZ2I7XG5cdHZhciB2YWw7XG5cblx0aWYgKHMgPT09IDApIHtcblx0XHR2YWwgPSBsICogMjU1O1xuXHRcdHJldHVybiBbdmFsLCB2YWwsIHZhbF07XG5cdH1cblxuXHRpZiAobCA8IDAuNSkge1xuXHRcdHQyID0gbCAqICgxICsgcyk7XG5cdH0gZWxzZSB7XG5cdFx0dDIgPSBsICsgcyAtIGwgKiBzO1xuXHR9XG5cblx0dDEgPSAyICogbCAtIHQyO1xuXG5cdHJnYiA9IFswLCAwLCAwXTtcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHtcblx0XHR0MyA9IGggKyAxIC8gMyAqIC0oaSAtIDEpO1xuXHRcdGlmICh0MyA8IDApIHtcblx0XHRcdHQzKys7XG5cdFx0fVxuXHRcdGlmICh0MyA+IDEpIHtcblx0XHRcdHQzLS07XG5cdFx0fVxuXG5cdFx0aWYgKDYgKiB0MyA8IDEpIHtcblx0XHRcdHZhbCA9IHQxICsgKHQyIC0gdDEpICogNiAqIHQzO1xuXHRcdH0gZWxzZSBpZiAoMiAqIHQzIDwgMSkge1xuXHRcdFx0dmFsID0gdDI7XG5cdFx0fSBlbHNlIGlmICgzICogdDMgPCAyKSB7XG5cdFx0XHR2YWwgPSB0MSArICh0MiAtIHQxKSAqICgyIC8gMyAtIHQzKSAqIDY7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHZhbCA9IHQxO1xuXHRcdH1cblxuXHRcdHJnYltpXSA9IHZhbCAqIDI1NTtcblx0fVxuXG5cdHJldHVybiByZ2I7XG59O1xuXG5jb252ZXJ0LmhzbC5oc3YgPSBmdW5jdGlvbiAoaHNsKSB7XG5cdHZhciBoID0gaHNsWzBdO1xuXHR2YXIgcyA9IGhzbFsxXSAvIDEwMDtcblx0dmFyIGwgPSBoc2xbMl0gLyAxMDA7XG5cdHZhciBzbWluID0gcztcblx0dmFyIGxtaW4gPSBNYXRoLm1heChsLCAwLjAxKTtcblx0dmFyIHN2O1xuXHR2YXIgdjtcblxuXHRsICo9IDI7XG5cdHMgKj0gKGwgPD0gMSkgPyBsIDogMiAtIGw7XG5cdHNtaW4gKj0gbG1pbiA8PSAxID8gbG1pbiA6IDIgLSBsbWluO1xuXHR2ID0gKGwgKyBzKSAvIDI7XG5cdHN2ID0gbCA9PT0gMCA/ICgyICogc21pbikgLyAobG1pbiArIHNtaW4pIDogKDIgKiBzKSAvIChsICsgcyk7XG5cblx0cmV0dXJuIFtoLCBzdiAqIDEwMCwgdiAqIDEwMF07XG59O1xuXG5jb252ZXJ0Lmhzdi5yZ2IgPSBmdW5jdGlvbiAoaHN2KSB7XG5cdHZhciBoID0gaHN2WzBdIC8gNjA7XG5cdHZhciBzID0gaHN2WzFdIC8gMTAwO1xuXHR2YXIgdiA9IGhzdlsyXSAvIDEwMDtcblx0dmFyIGhpID0gTWF0aC5mbG9vcihoKSAlIDY7XG5cblx0dmFyIGYgPSBoIC0gTWF0aC5mbG9vcihoKTtcblx0dmFyIHAgPSAyNTUgKiB2ICogKDEgLSBzKTtcblx0dmFyIHEgPSAyNTUgKiB2ICogKDEgLSAocyAqIGYpKTtcblx0dmFyIHQgPSAyNTUgKiB2ICogKDEgLSAocyAqICgxIC0gZikpKTtcblx0diAqPSAyNTU7XG5cblx0c3dpdGNoIChoaSkge1xuXHRcdGNhc2UgMDpcblx0XHRcdHJldHVybiBbdiwgdCwgcF07XG5cdFx0Y2FzZSAxOlxuXHRcdFx0cmV0dXJuIFtxLCB2LCBwXTtcblx0XHRjYXNlIDI6XG5cdFx0XHRyZXR1cm4gW3AsIHYsIHRdO1xuXHRcdGNhc2UgMzpcblx0XHRcdHJldHVybiBbcCwgcSwgdl07XG5cdFx0Y2FzZSA0OlxuXHRcdFx0cmV0dXJuIFt0LCBwLCB2XTtcblx0XHRjYXNlIDU6XG5cdFx0XHRyZXR1cm4gW3YsIHAsIHFdO1xuXHR9XG59O1xuXG5jb252ZXJ0Lmhzdi5oc2wgPSBmdW5jdGlvbiAoaHN2KSB7XG5cdHZhciBoID0gaHN2WzBdO1xuXHR2YXIgcyA9IGhzdlsxXSAvIDEwMDtcblx0dmFyIHYgPSBoc3ZbMl0gLyAxMDA7XG5cdHZhciB2bWluID0gTWF0aC5tYXgodiwgMC4wMSk7XG5cdHZhciBsbWluO1xuXHR2YXIgc2w7XG5cdHZhciBsO1xuXG5cdGwgPSAoMiAtIHMpICogdjtcblx0bG1pbiA9ICgyIC0gcykgKiB2bWluO1xuXHRzbCA9IHMgKiB2bWluO1xuXHRzbCAvPSAobG1pbiA8PSAxKSA/IGxtaW4gOiAyIC0gbG1pbjtcblx0c2wgPSBzbCB8fCAwO1xuXHRsIC89IDI7XG5cblx0cmV0dXJuIFtoLCBzbCAqIDEwMCwgbCAqIDEwMF07XG59O1xuXG4vLyBodHRwOi8vZGV2LnczLm9yZy9jc3N3Zy9jc3MtY29sb3IvI2h3Yi10by1yZ2JcbmNvbnZlcnQuaHdiLnJnYiA9IGZ1bmN0aW9uIChod2IpIHtcblx0dmFyIGggPSBod2JbMF0gLyAzNjA7XG5cdHZhciB3aCA9IGh3YlsxXSAvIDEwMDtcblx0dmFyIGJsID0gaHdiWzJdIC8gMTAwO1xuXHR2YXIgcmF0aW8gPSB3aCArIGJsO1xuXHR2YXIgaTtcblx0dmFyIHY7XG5cdHZhciBmO1xuXHR2YXIgbjtcblxuXHQvLyB3aCArIGJsIGNhbnQgYmUgPiAxXG5cdGlmIChyYXRpbyA+IDEpIHtcblx0XHR3aCAvPSByYXRpbztcblx0XHRibCAvPSByYXRpbztcblx0fVxuXG5cdGkgPSBNYXRoLmZsb29yKDYgKiBoKTtcblx0diA9IDEgLSBibDtcblx0ZiA9IDYgKiBoIC0gaTtcblxuXHRpZiAoKGkgJiAweDAxKSAhPT0gMCkge1xuXHRcdGYgPSAxIC0gZjtcblx0fVxuXG5cdG4gPSB3aCArIGYgKiAodiAtIHdoKTsgLy8gbGluZWFyIGludGVycG9sYXRpb25cblxuXHR2YXIgcjtcblx0dmFyIGc7XG5cdHZhciBiO1xuXHRzd2l0Y2ggKGkpIHtcblx0XHRkZWZhdWx0OlxuXHRcdGNhc2UgNjpcblx0XHRjYXNlIDA6IHIgPSB2OyBnID0gbjsgYiA9IHdoOyBicmVhaztcblx0XHRjYXNlIDE6IHIgPSBuOyBnID0gdjsgYiA9IHdoOyBicmVhaztcblx0XHRjYXNlIDI6IHIgPSB3aDsgZyA9IHY7IGIgPSBuOyBicmVhaztcblx0XHRjYXNlIDM6IHIgPSB3aDsgZyA9IG47IGIgPSB2OyBicmVhaztcblx0XHRjYXNlIDQ6IHIgPSBuOyBnID0gd2g7IGIgPSB2OyBicmVhaztcblx0XHRjYXNlIDU6IHIgPSB2OyBnID0gd2g7IGIgPSBuOyBicmVhaztcblx0fVxuXG5cdHJldHVybiBbciAqIDI1NSwgZyAqIDI1NSwgYiAqIDI1NV07XG59O1xuXG5jb252ZXJ0LmNteWsucmdiID0gZnVuY3Rpb24gKGNteWspIHtcblx0dmFyIGMgPSBjbXlrWzBdIC8gMTAwO1xuXHR2YXIgbSA9IGNteWtbMV0gLyAxMDA7XG5cdHZhciB5ID0gY215a1syXSAvIDEwMDtcblx0dmFyIGsgPSBjbXlrWzNdIC8gMTAwO1xuXHR2YXIgcjtcblx0dmFyIGc7XG5cdHZhciBiO1xuXG5cdHIgPSAxIC0gTWF0aC5taW4oMSwgYyAqICgxIC0gaykgKyBrKTtcblx0ZyA9IDEgLSBNYXRoLm1pbigxLCBtICogKDEgLSBrKSArIGspO1xuXHRiID0gMSAtIE1hdGgubWluKDEsIHkgKiAoMSAtIGspICsgayk7XG5cblx0cmV0dXJuIFtyICogMjU1LCBnICogMjU1LCBiICogMjU1XTtcbn07XG5cbmNvbnZlcnQueHl6LnJnYiA9IGZ1bmN0aW9uICh4eXopIHtcblx0dmFyIHggPSB4eXpbMF0gLyAxMDA7XG5cdHZhciB5ID0geHl6WzFdIC8gMTAwO1xuXHR2YXIgeiA9IHh5elsyXSAvIDEwMDtcblx0dmFyIHI7XG5cdHZhciBnO1xuXHR2YXIgYjtcblxuXHRyID0gKHggKiAzLjI0MDYpICsgKHkgKiAtMS41MzcyKSArICh6ICogLTAuNDk4Nik7XG5cdGcgPSAoeCAqIC0wLjk2ODkpICsgKHkgKiAxLjg3NTgpICsgKHogKiAwLjA0MTUpO1xuXHRiID0gKHggKiAwLjA1NTcpICsgKHkgKiAtMC4yMDQwKSArICh6ICogMS4wNTcwKTtcblxuXHQvLyBhc3N1bWUgc1JHQlxuXHRyID0gciA+IDAuMDAzMTMwOFxuXHRcdD8gKCgxLjA1NSAqIE1hdGgucG93KHIsIDEuMCAvIDIuNCkpIC0gMC4wNTUpXG5cdFx0OiByICogMTIuOTI7XG5cblx0ZyA9IGcgPiAwLjAwMzEzMDhcblx0XHQ/ICgoMS4wNTUgKiBNYXRoLnBvdyhnLCAxLjAgLyAyLjQpKSAtIDAuMDU1KVxuXHRcdDogZyAqIDEyLjkyO1xuXG5cdGIgPSBiID4gMC4wMDMxMzA4XG5cdFx0PyAoKDEuMDU1ICogTWF0aC5wb3coYiwgMS4wIC8gMi40KSkgLSAwLjA1NSlcblx0XHQ6IGIgKiAxMi45MjtcblxuXHRyID0gTWF0aC5taW4oTWF0aC5tYXgoMCwgciksIDEpO1xuXHRnID0gTWF0aC5taW4oTWF0aC5tYXgoMCwgZyksIDEpO1xuXHRiID0gTWF0aC5taW4oTWF0aC5tYXgoMCwgYiksIDEpO1xuXG5cdHJldHVybiBbciAqIDI1NSwgZyAqIDI1NSwgYiAqIDI1NV07XG59O1xuXG5jb252ZXJ0Lnh5ei5sYWIgPSBmdW5jdGlvbiAoeHl6KSB7XG5cdHZhciB4ID0geHl6WzBdO1xuXHR2YXIgeSA9IHh5elsxXTtcblx0dmFyIHogPSB4eXpbMl07XG5cdHZhciBsO1xuXHR2YXIgYTtcblx0dmFyIGI7XG5cblx0eCAvPSA5NS4wNDc7XG5cdHkgLz0gMTAwO1xuXHR6IC89IDEwOC44ODM7XG5cblx0eCA9IHggPiAwLjAwODg1NiA/IE1hdGgucG93KHgsIDEgLyAzKSA6ICg3Ljc4NyAqIHgpICsgKDE2IC8gMTE2KTtcblx0eSA9IHkgPiAwLjAwODg1NiA/IE1hdGgucG93KHksIDEgLyAzKSA6ICg3Ljc4NyAqIHkpICsgKDE2IC8gMTE2KTtcblx0eiA9IHogPiAwLjAwODg1NiA/IE1hdGgucG93KHosIDEgLyAzKSA6ICg3Ljc4NyAqIHopICsgKDE2IC8gMTE2KTtcblxuXHRsID0gKDExNiAqIHkpIC0gMTY7XG5cdGEgPSA1MDAgKiAoeCAtIHkpO1xuXHRiID0gMjAwICogKHkgLSB6KTtcblxuXHRyZXR1cm4gW2wsIGEsIGJdO1xufTtcblxuY29udmVydC5sYWIueHl6ID0gZnVuY3Rpb24gKGxhYikge1xuXHR2YXIgbCA9IGxhYlswXTtcblx0dmFyIGEgPSBsYWJbMV07XG5cdHZhciBiID0gbGFiWzJdO1xuXHR2YXIgeDtcblx0dmFyIHk7XG5cdHZhciB6O1xuXG5cdHkgPSAobCArIDE2KSAvIDExNjtcblx0eCA9IGEgLyA1MDAgKyB5O1xuXHR6ID0geSAtIGIgLyAyMDA7XG5cblx0dmFyIHkyID0gTWF0aC5wb3coeSwgMyk7XG5cdHZhciB4MiA9IE1hdGgucG93KHgsIDMpO1xuXHR2YXIgejIgPSBNYXRoLnBvdyh6LCAzKTtcblx0eSA9IHkyID4gMC4wMDg4NTYgPyB5MiA6ICh5IC0gMTYgLyAxMTYpIC8gNy43ODc7XG5cdHggPSB4MiA+IDAuMDA4ODU2ID8geDIgOiAoeCAtIDE2IC8gMTE2KSAvIDcuNzg3O1xuXHR6ID0gejIgPiAwLjAwODg1NiA/IHoyIDogKHogLSAxNiAvIDExNikgLyA3Ljc4NztcblxuXHR4ICo9IDk1LjA0Nztcblx0eSAqPSAxMDA7XG5cdHogKj0gMTA4Ljg4MztcblxuXHRyZXR1cm4gW3gsIHksIHpdO1xufTtcblxuY29udmVydC5sYWIubGNoID0gZnVuY3Rpb24gKGxhYikge1xuXHR2YXIgbCA9IGxhYlswXTtcblx0dmFyIGEgPSBsYWJbMV07XG5cdHZhciBiID0gbGFiWzJdO1xuXHR2YXIgaHI7XG5cdHZhciBoO1xuXHR2YXIgYztcblxuXHRociA9IE1hdGguYXRhbjIoYiwgYSk7XG5cdGggPSBociAqIDM2MCAvIDIgLyBNYXRoLlBJO1xuXG5cdGlmIChoIDwgMCkge1xuXHRcdGggKz0gMzYwO1xuXHR9XG5cblx0YyA9IE1hdGguc3FydChhICogYSArIGIgKiBiKTtcblxuXHRyZXR1cm4gW2wsIGMsIGhdO1xufTtcblxuY29udmVydC5sY2gubGFiID0gZnVuY3Rpb24gKGxjaCkge1xuXHR2YXIgbCA9IGxjaFswXTtcblx0dmFyIGMgPSBsY2hbMV07XG5cdHZhciBoID0gbGNoWzJdO1xuXHR2YXIgYTtcblx0dmFyIGI7XG5cdHZhciBocjtcblxuXHRociA9IGggLyAzNjAgKiAyICogTWF0aC5QSTtcblx0YSA9IGMgKiBNYXRoLmNvcyhocik7XG5cdGIgPSBjICogTWF0aC5zaW4oaHIpO1xuXG5cdHJldHVybiBbbCwgYSwgYl07XG59O1xuXG5jb252ZXJ0LnJnYi5hbnNpMTYgPSBmdW5jdGlvbiAoYXJncykge1xuXHR2YXIgciA9IGFyZ3NbMF07XG5cdHZhciBnID0gYXJnc1sxXTtcblx0dmFyIGIgPSBhcmdzWzJdO1xuXHR2YXIgdmFsdWUgPSAxIGluIGFyZ3VtZW50cyA/IGFyZ3VtZW50c1sxXSA6IGNvbnZlcnQucmdiLmhzdihhcmdzKVsyXTsgLy8gaHN2IC0+IGFuc2kxNiBvcHRpbWl6YXRpb25cblxuXHR2YWx1ZSA9IE1hdGgucm91bmQodmFsdWUgLyA1MCk7XG5cblx0aWYgKHZhbHVlID09PSAwKSB7XG5cdFx0cmV0dXJuIDMwO1xuXHR9XG5cblx0dmFyIGFuc2kgPSAzMFxuXHRcdCsgKChNYXRoLnJvdW5kKGIgLyAyNTUpIDw8IDIpXG5cdFx0fCAoTWF0aC5yb3VuZChnIC8gMjU1KSA8PCAxKVxuXHRcdHwgTWF0aC5yb3VuZChyIC8gMjU1KSk7XG5cblx0aWYgKHZhbHVlID09PSAyKSB7XG5cdFx0YW5zaSArPSA2MDtcblx0fVxuXG5cdHJldHVybiBhbnNpO1xufTtcblxuY29udmVydC5oc3YuYW5zaTE2ID0gZnVuY3Rpb24gKGFyZ3MpIHtcblx0Ly8gb3B0aW1pemF0aW9uIGhlcmU7IHdlIGFscmVhZHkga25vdyB0aGUgdmFsdWUgYW5kIGRvbid0IG5lZWQgdG8gZ2V0XG5cdC8vIGl0IGNvbnZlcnRlZCBmb3IgdXMuXG5cdHJldHVybiBjb252ZXJ0LnJnYi5hbnNpMTYoY29udmVydC5oc3YucmdiKGFyZ3MpLCBhcmdzWzJdKTtcbn07XG5cbmNvbnZlcnQucmdiLmFuc2kyNTYgPSBmdW5jdGlvbiAoYXJncykge1xuXHR2YXIgciA9IGFyZ3NbMF07XG5cdHZhciBnID0gYXJnc1sxXTtcblx0dmFyIGIgPSBhcmdzWzJdO1xuXG5cdC8vIHdlIHVzZSB0aGUgZXh0ZW5kZWQgZ3JleXNjYWxlIHBhbGV0dGUgaGVyZSwgd2l0aCB0aGUgZXhjZXB0aW9uIG9mXG5cdC8vIGJsYWNrIGFuZCB3aGl0ZS4gbm9ybWFsIHBhbGV0dGUgb25seSBoYXMgNCBncmV5c2NhbGUgc2hhZGVzLlxuXHRpZiAociA9PT0gZyAmJiBnID09PSBiKSB7XG5cdFx0aWYgKHIgPCA4KSB7XG5cdFx0XHRyZXR1cm4gMTY7XG5cdFx0fVxuXG5cdFx0aWYgKHIgPiAyNDgpIHtcblx0XHRcdHJldHVybiAyMzE7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIE1hdGgucm91bmQoKChyIC0gOCkgLyAyNDcpICogMjQpICsgMjMyO1xuXHR9XG5cblx0dmFyIGFuc2kgPSAxNlxuXHRcdCsgKDM2ICogTWF0aC5yb3VuZChyIC8gMjU1ICogNSkpXG5cdFx0KyAoNiAqIE1hdGgucm91bmQoZyAvIDI1NSAqIDUpKVxuXHRcdCsgTWF0aC5yb3VuZChiIC8gMjU1ICogNSk7XG5cblx0cmV0dXJuIGFuc2k7XG59O1xuXG5jb252ZXJ0LmFuc2kxNi5yZ2IgPSBmdW5jdGlvbiAoYXJncykge1xuXHR2YXIgY29sb3IgPSBhcmdzICUgMTA7XG5cblx0Ly8gaGFuZGxlIGdyZXlzY2FsZVxuXHRpZiAoY29sb3IgPT09IDAgfHwgY29sb3IgPT09IDcpIHtcblx0XHRpZiAoYXJncyA+IDUwKSB7XG5cdFx0XHRjb2xvciArPSAzLjU7XG5cdFx0fVxuXG5cdFx0Y29sb3IgPSBjb2xvciAvIDEwLjUgKiAyNTU7XG5cblx0XHRyZXR1cm4gW2NvbG9yLCBjb2xvciwgY29sb3JdO1xuXHR9XG5cblx0dmFyIG11bHQgPSAofn4oYXJncyA+IDUwKSArIDEpICogMC41O1xuXHR2YXIgciA9ICgoY29sb3IgJiAxKSAqIG11bHQpICogMjU1O1xuXHR2YXIgZyA9ICgoKGNvbG9yID4+IDEpICYgMSkgKiBtdWx0KSAqIDI1NTtcblx0dmFyIGIgPSAoKChjb2xvciA+PiAyKSAmIDEpICogbXVsdCkgKiAyNTU7XG5cblx0cmV0dXJuIFtyLCBnLCBiXTtcbn07XG5cbmNvbnZlcnQuYW5zaTI1Ni5yZ2IgPSBmdW5jdGlvbiAoYXJncykge1xuXHQvLyBoYW5kbGUgZ3JleXNjYWxlXG5cdGlmIChhcmdzID49IDIzMikge1xuXHRcdHZhciBjID0gKGFyZ3MgLSAyMzIpICogMTAgKyA4O1xuXHRcdHJldHVybiBbYywgYywgY107XG5cdH1cblxuXHRhcmdzIC09IDE2O1xuXG5cdHZhciByZW07XG5cdHZhciByID0gTWF0aC5mbG9vcihhcmdzIC8gMzYpIC8gNSAqIDI1NTtcblx0dmFyIGcgPSBNYXRoLmZsb29yKChyZW0gPSBhcmdzICUgMzYpIC8gNikgLyA1ICogMjU1O1xuXHR2YXIgYiA9IChyZW0gJSA2KSAvIDUgKiAyNTU7XG5cblx0cmV0dXJuIFtyLCBnLCBiXTtcbn07XG5cbmNvbnZlcnQucmdiLmhleCA9IGZ1bmN0aW9uIChhcmdzKSB7XG5cdHZhciBpbnRlZ2VyID0gKChNYXRoLnJvdW5kKGFyZ3NbMF0pICYgMHhGRikgPDwgMTYpXG5cdFx0KyAoKE1hdGgucm91bmQoYXJnc1sxXSkgJiAweEZGKSA8PCA4KVxuXHRcdCsgKE1hdGgucm91bmQoYXJnc1syXSkgJiAweEZGKTtcblxuXHR2YXIgc3RyaW5nID0gaW50ZWdlci50b1N0cmluZygxNikudG9VcHBlckNhc2UoKTtcblx0cmV0dXJuICcwMDAwMDAnLnN1YnN0cmluZyhzdHJpbmcubGVuZ3RoKSArIHN0cmluZztcbn07XG5cbmNvbnZlcnQuaGV4LnJnYiA9IGZ1bmN0aW9uIChhcmdzKSB7XG5cdHZhciBtYXRjaCA9IGFyZ3MudG9TdHJpbmcoMTYpLm1hdGNoKC9bYS1mMC05XXs2fXxbYS1mMC05XXszfS9pKTtcblx0aWYgKCFtYXRjaCkge1xuXHRcdHJldHVybiBbMCwgMCwgMF07XG5cdH1cblxuXHR2YXIgY29sb3JTdHJpbmcgPSBtYXRjaFswXTtcblxuXHRpZiAobWF0Y2hbMF0ubGVuZ3RoID09PSAzKSB7XG5cdFx0Y29sb3JTdHJpbmcgPSBjb2xvclN0cmluZy5zcGxpdCgnJykubWFwKGZ1bmN0aW9uIChjaGFyKSB7XG5cdFx0XHRyZXR1cm4gY2hhciArIGNoYXI7XG5cdFx0fSkuam9pbignJyk7XG5cdH1cblxuXHR2YXIgaW50ZWdlciA9IHBhcnNlSW50KGNvbG9yU3RyaW5nLCAxNik7XG5cdHZhciByID0gKGludGVnZXIgPj4gMTYpICYgMHhGRjtcblx0dmFyIGcgPSAoaW50ZWdlciA+PiA4KSAmIDB4RkY7XG5cdHZhciBiID0gaW50ZWdlciAmIDB4RkY7XG5cblx0cmV0dXJuIFtyLCBnLCBiXTtcbn07XG5cbmNvbnZlcnQucmdiLmhjZyA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0dmFyIHIgPSByZ2JbMF0gLyAyNTU7XG5cdHZhciBnID0gcmdiWzFdIC8gMjU1O1xuXHR2YXIgYiA9IHJnYlsyXSAvIDI1NTtcblx0dmFyIG1heCA9IE1hdGgubWF4KE1hdGgubWF4KHIsIGcpLCBiKTtcblx0dmFyIG1pbiA9IE1hdGgubWluKE1hdGgubWluKHIsIGcpLCBiKTtcblx0dmFyIGNocm9tYSA9IChtYXggLSBtaW4pO1xuXHR2YXIgZ3JheXNjYWxlO1xuXHR2YXIgaHVlO1xuXG5cdGlmIChjaHJvbWEgPCAxKSB7XG5cdFx0Z3JheXNjYWxlID0gbWluIC8gKDEgLSBjaHJvbWEpO1xuXHR9IGVsc2Uge1xuXHRcdGdyYXlzY2FsZSA9IDA7XG5cdH1cblxuXHRpZiAoY2hyb21hIDw9IDApIHtcblx0XHRodWUgPSAwO1xuXHR9IGVsc2Vcblx0aWYgKG1heCA9PT0gcikge1xuXHRcdGh1ZSA9ICgoZyAtIGIpIC8gY2hyb21hKSAlIDY7XG5cdH0gZWxzZVxuXHRpZiAobWF4ID09PSBnKSB7XG5cdFx0aHVlID0gMiArIChiIC0gcikgLyBjaHJvbWE7XG5cdH0gZWxzZSB7XG5cdFx0aHVlID0gNCArIChyIC0gZykgLyBjaHJvbWEgKyA0O1xuXHR9XG5cblx0aHVlIC89IDY7XG5cdGh1ZSAlPSAxO1xuXG5cdHJldHVybiBbaHVlICogMzYwLCBjaHJvbWEgKiAxMDAsIGdyYXlzY2FsZSAqIDEwMF07XG59O1xuXG5jb252ZXJ0LmhzbC5oY2cgPSBmdW5jdGlvbiAoaHNsKSB7XG5cdHZhciBzID0gaHNsWzFdIC8gMTAwO1xuXHR2YXIgbCA9IGhzbFsyXSAvIDEwMDtcblx0dmFyIGMgPSAxO1xuXHR2YXIgZiA9IDA7XG5cblx0aWYgKGwgPCAwLjUpIHtcblx0XHRjID0gMi4wICogcyAqIGw7XG5cdH0gZWxzZSB7XG5cdFx0YyA9IDIuMCAqIHMgKiAoMS4wIC0gbCk7XG5cdH1cblxuXHRpZiAoYyA8IDEuMCkge1xuXHRcdGYgPSAobCAtIDAuNSAqIGMpIC8gKDEuMCAtIGMpO1xuXHR9XG5cblx0cmV0dXJuIFtoc2xbMF0sIGMgKiAxMDAsIGYgKiAxMDBdO1xufTtcblxuY29udmVydC5oc3YuaGNnID0gZnVuY3Rpb24gKGhzdikge1xuXHR2YXIgcyA9IGhzdlsxXSAvIDEwMDtcblx0dmFyIHYgPSBoc3ZbMl0gLyAxMDA7XG5cblx0dmFyIGMgPSBzICogdjtcblx0dmFyIGYgPSAwO1xuXG5cdGlmIChjIDwgMS4wKSB7XG5cdFx0ZiA9ICh2IC0gYykgLyAoMSAtIGMpO1xuXHR9XG5cblx0cmV0dXJuIFtoc3ZbMF0sIGMgKiAxMDAsIGYgKiAxMDBdO1xufTtcblxuY29udmVydC5oY2cucmdiID0gZnVuY3Rpb24gKGhjZykge1xuXHR2YXIgaCA9IGhjZ1swXSAvIDM2MDtcblx0dmFyIGMgPSBoY2dbMV0gLyAxMDA7XG5cdHZhciBnID0gaGNnWzJdIC8gMTAwO1xuXG5cdGlmIChjID09PSAwLjApIHtcblx0XHRyZXR1cm4gW2cgKiAyNTUsIGcgKiAyNTUsIGcgKiAyNTVdO1xuXHR9XG5cblx0dmFyIHB1cmUgPSBbMCwgMCwgMF07XG5cdHZhciBoaSA9IChoICUgMSkgKiA2O1xuXHR2YXIgdiA9IGhpICUgMTtcblx0dmFyIHcgPSAxIC0gdjtcblx0dmFyIG1nID0gMDtcblxuXHRzd2l0Y2ggKE1hdGguZmxvb3IoaGkpKSB7XG5cdFx0Y2FzZSAwOlxuXHRcdFx0cHVyZVswXSA9IDE7IHB1cmVbMV0gPSB2OyBwdXJlWzJdID0gMDsgYnJlYWs7XG5cdFx0Y2FzZSAxOlxuXHRcdFx0cHVyZVswXSA9IHc7IHB1cmVbMV0gPSAxOyBwdXJlWzJdID0gMDsgYnJlYWs7XG5cdFx0Y2FzZSAyOlxuXHRcdFx0cHVyZVswXSA9IDA7IHB1cmVbMV0gPSAxOyBwdXJlWzJdID0gdjsgYnJlYWs7XG5cdFx0Y2FzZSAzOlxuXHRcdFx0cHVyZVswXSA9IDA7IHB1cmVbMV0gPSB3OyBwdXJlWzJdID0gMTsgYnJlYWs7XG5cdFx0Y2FzZSA0OlxuXHRcdFx0cHVyZVswXSA9IHY7IHB1cmVbMV0gPSAwOyBwdXJlWzJdID0gMTsgYnJlYWs7XG5cdFx0ZGVmYXVsdDpcblx0XHRcdHB1cmVbMF0gPSAxOyBwdXJlWzFdID0gMDsgcHVyZVsyXSA9IHc7XG5cdH1cblxuXHRtZyA9ICgxLjAgLSBjKSAqIGc7XG5cblx0cmV0dXJuIFtcblx0XHQoYyAqIHB1cmVbMF0gKyBtZykgKiAyNTUsXG5cdFx0KGMgKiBwdXJlWzFdICsgbWcpICogMjU1LFxuXHRcdChjICogcHVyZVsyXSArIG1nKSAqIDI1NVxuXHRdO1xufTtcblxuY29udmVydC5oY2cuaHN2ID0gZnVuY3Rpb24gKGhjZykge1xuXHR2YXIgYyA9IGhjZ1sxXSAvIDEwMDtcblx0dmFyIGcgPSBoY2dbMl0gLyAxMDA7XG5cblx0dmFyIHYgPSBjICsgZyAqICgxLjAgLSBjKTtcblx0dmFyIGYgPSAwO1xuXG5cdGlmICh2ID4gMC4wKSB7XG5cdFx0ZiA9IGMgLyB2O1xuXHR9XG5cblx0cmV0dXJuIFtoY2dbMF0sIGYgKiAxMDAsIHYgKiAxMDBdO1xufTtcblxuY29udmVydC5oY2cuaHNsID0gZnVuY3Rpb24gKGhjZykge1xuXHR2YXIgYyA9IGhjZ1sxXSAvIDEwMDtcblx0dmFyIGcgPSBoY2dbMl0gLyAxMDA7XG5cblx0dmFyIGwgPSBnICogKDEuMCAtIGMpICsgMC41ICogYztcblx0dmFyIHMgPSAwO1xuXG5cdGlmIChsID4gMC4wICYmIGwgPCAwLjUpIHtcblx0XHRzID0gYyAvICgyICogbCk7XG5cdH0gZWxzZVxuXHRpZiAobCA+PSAwLjUgJiYgbCA8IDEuMCkge1xuXHRcdHMgPSBjIC8gKDIgKiAoMSAtIGwpKTtcblx0fVxuXG5cdHJldHVybiBbaGNnWzBdLCBzICogMTAwLCBsICogMTAwXTtcbn07XG5cbmNvbnZlcnQuaGNnLmh3YiA9IGZ1bmN0aW9uIChoY2cpIHtcblx0dmFyIGMgPSBoY2dbMV0gLyAxMDA7XG5cdHZhciBnID0gaGNnWzJdIC8gMTAwO1xuXHR2YXIgdiA9IGMgKyBnICogKDEuMCAtIGMpO1xuXHRyZXR1cm4gW2hjZ1swXSwgKHYgLSBjKSAqIDEwMCwgKDEgLSB2KSAqIDEwMF07XG59O1xuXG5jb252ZXJ0Lmh3Yi5oY2cgPSBmdW5jdGlvbiAoaHdiKSB7XG5cdHZhciB3ID0gaHdiWzFdIC8gMTAwO1xuXHR2YXIgYiA9IGh3YlsyXSAvIDEwMDtcblx0dmFyIHYgPSAxIC0gYjtcblx0dmFyIGMgPSB2IC0gdztcblx0dmFyIGcgPSAwO1xuXG5cdGlmIChjIDwgMSkge1xuXHRcdGcgPSAodiAtIGMpIC8gKDEgLSBjKTtcblx0fVxuXG5cdHJldHVybiBbaHdiWzBdLCBjICogMTAwLCBnICogMTAwXTtcbn07XG5cbmNvbnZlcnQuYXBwbGUucmdiID0gZnVuY3Rpb24gKGFwcGxlKSB7XG5cdHJldHVybiBbKGFwcGxlWzBdIC8gNjU1MzUpICogMjU1LCAoYXBwbGVbMV0gLyA2NTUzNSkgKiAyNTUsIChhcHBsZVsyXSAvIDY1NTM1KSAqIDI1NV07XG59O1xuXG5jb252ZXJ0LnJnYi5hcHBsZSA9IGZ1bmN0aW9uIChyZ2IpIHtcblx0cmV0dXJuIFsocmdiWzBdIC8gMjU1KSAqIDY1NTM1LCAocmdiWzFdIC8gMjU1KSAqIDY1NTM1LCAocmdiWzJdIC8gMjU1KSAqIDY1NTM1XTtcbn07XG5cbmNvbnZlcnQuZ3JheS5yZ2IgPSBmdW5jdGlvbiAoYXJncykge1xuXHRyZXR1cm4gW2FyZ3NbMF0gLyAxMDAgKiAyNTUsIGFyZ3NbMF0gLyAxMDAgKiAyNTUsIGFyZ3NbMF0gLyAxMDAgKiAyNTVdO1xufTtcblxuY29udmVydC5ncmF5LmhzbCA9IGNvbnZlcnQuZ3JheS5oc3YgPSBmdW5jdGlvbiAoYXJncykge1xuXHRyZXR1cm4gWzAsIDAsIGFyZ3NbMF1dO1xufTtcblxuY29udmVydC5ncmF5Lmh3YiA9IGZ1bmN0aW9uIChncmF5KSB7XG5cdHJldHVybiBbMCwgMTAwLCBncmF5WzBdXTtcbn07XG5cbmNvbnZlcnQuZ3JheS5jbXlrID0gZnVuY3Rpb24gKGdyYXkpIHtcblx0cmV0dXJuIFswLCAwLCAwLCBncmF5WzBdXTtcbn07XG5cbmNvbnZlcnQuZ3JheS5sYWIgPSBmdW5jdGlvbiAoZ3JheSkge1xuXHRyZXR1cm4gW2dyYXlbMF0sIDAsIDBdO1xufTtcblxuY29udmVydC5ncmF5LmhleCA9IGZ1bmN0aW9uIChncmF5KSB7XG5cdHZhciB2YWwgPSBNYXRoLnJvdW5kKGdyYXlbMF0gLyAxMDAgKiAyNTUpICYgMHhGRjtcblx0dmFyIGludGVnZXIgPSAodmFsIDw8IDE2KSArICh2YWwgPDwgOCkgKyB2YWw7XG5cblx0dmFyIHN0cmluZyA9IGludGVnZXIudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCk7XG5cdHJldHVybiAnMDAwMDAwJy5zdWJzdHJpbmcoc3RyaW5nLmxlbmd0aCkgKyBzdHJpbmc7XG59O1xuXG5jb252ZXJ0LnJnYi5ncmF5ID0gZnVuY3Rpb24gKHJnYikge1xuXHR2YXIgdmFsID0gKHJnYlswXSArIHJnYlsxXSArIHJnYlsyXSkgLyAzO1xuXHRyZXR1cm4gW3ZhbCAvIDI1NSAqIDEwMF07XG59O1xuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IHsgdmVyc2lvbiB9ID0gcmVxdWlyZSgnLi4vcGFja2FnZS5qc29uJylcblxuY29uc3QgTE9HX1ZFUlNJT04gPSAxXG5cbm1vZHVsZS5leHBvcnRzID0geyB2ZXJzaW9uLCBMT0dfVkVSU0lPTiB9XG4iLCIndXNlIHN0cmljdCdcbmNvbnN0IG9zID0gcmVxdWlyZSgnb3MnKVxuY29uc3Qgc3RkU2VyaWFsaXplcnMgPSByZXF1aXJlKCdwaW5vLXN0ZC1zZXJpYWxpemVycycpXG5jb25zdCByZWRhY3Rpb24gPSByZXF1aXJlKCcuL2xpYi9yZWRhY3Rpb24nKVxuY29uc3QgdGltZSA9IHJlcXVpcmUoJy4vbGliL3RpbWUnKVxuY29uc3QgcHJvdG8gPSByZXF1aXJlKCcuL2xpYi9wcm90bycpXG5jb25zdCBzeW1ib2xzID0gcmVxdWlyZSgnLi9saWIvc3ltYm9scycpXG5jb25zdCB7IGFzc2VydERlZmF1bHRMZXZlbEZvdW5kLCBtYXBwaW5ncywgZ2VuTHNDYWNoZSB9ID0gcmVxdWlyZSgnLi9saWIvbGV2ZWxzJylcbmNvbnN0IHtcbiAgY3JlYXRlQXJnc05vcm1hbGl6ZXIsXG4gIGFzQ2hpbmRpbmdzLFxuICBmaW5hbCxcbiAgc3RyaW5naWZ5LFxuICBidWlsZFNhZmVTb25pY0Jvb21cbn0gPSByZXF1aXJlKCcuL2xpYi90b29scycpXG5jb25zdCB7IHZlcnNpb24sIExPR19WRVJTSU9OIH0gPSByZXF1aXJlKCcuL2xpYi9tZXRhJylcbmNvbnN0IHtcbiAgY2hpbmRpbmdzU3ltLFxuICByZWRhY3RGbXRTeW0sXG4gIHNlcmlhbGl6ZXJzU3ltLFxuICB0aW1lU3ltLFxuICBzdHJlYW1TeW0sXG4gIHN0cmluZ2lmeVN5bSxcbiAgc3RyaW5naWZpZXJzU3ltLFxuICBzZXRMZXZlbFN5bSxcbiAgZW5kU3ltLFxuICBmb3JtYXRPcHRzU3ltLFxuICBtZXNzYWdlS2V5U3RyaW5nU3ltLFxuICB1c2VMZXZlbExhYmVsc1N5bSxcbiAgY2hhbmdlTGV2ZWxOYW1lU3ltLFxuICB1c2VPbmx5Q3VzdG9tTGV2ZWxzU3ltXG59ID0gc3ltYm9sc1xuY29uc3QgeyBlcG9jaFRpbWUsIG51bGxUaW1lIH0gPSB0aW1lXG5jb25zdCB7IHBpZCB9ID0gcHJvY2Vzc1xuY29uc3QgaG9zdG5hbWUgPSBvcy5ob3N0bmFtZSgpXG5jb25zdCBkZWZhdWx0RXJyb3JTZXJpYWxpemVyID0gc3RkU2VyaWFsaXplcnMuZXJyXG5jb25zdCBkZWZhdWx0T3B0aW9ucyA9IHtcbiAgbGV2ZWw6ICdpbmZvJyxcbiAgdXNlTGV2ZWxMYWJlbHM6IGZhbHNlLFxuICBtZXNzYWdlS2V5OiAnbXNnJyxcbiAgZW5hYmxlZDogdHJ1ZSxcbiAgcHJldHR5UHJpbnQ6IGZhbHNlLFxuICBiYXNlOiB7IHBpZCwgaG9zdG5hbWUgfSxcbiAgc2VyaWFsaXplcnM6IE9iamVjdC5hc3NpZ24oT2JqZWN0LmNyZWF0ZShudWxsKSwge1xuICAgIGVycjogZGVmYXVsdEVycm9yU2VyaWFsaXplclxuICB9KSxcbiAgdGltZXN0YW1wOiBlcG9jaFRpbWUsXG4gIG5hbWU6IHVuZGVmaW5lZCxcbiAgcmVkYWN0OiBudWxsLFxuICBjdXN0b21MZXZlbHM6IG51bGwsXG4gIGNoYW5nZUxldmVsTmFtZTogJ2xldmVsJyxcbiAgdXNlT25seUN1c3RvbUxldmVsczogZmFsc2Vcbn1cblxuY29uc3Qgbm9ybWFsaXplID0gY3JlYXRlQXJnc05vcm1hbGl6ZXIoZGVmYXVsdE9wdGlvbnMpXG5cbmNvbnN0IHNlcmlhbGl6ZXJzID0gT2JqZWN0LmFzc2lnbihPYmplY3QuY3JlYXRlKG51bGwpLCBzdGRTZXJpYWxpemVycylcblxuZnVuY3Rpb24gcGlubyAoLi4uYXJncykge1xuICBjb25zdCB7IG9wdHMsIHN0cmVhbSB9ID0gbm9ybWFsaXplKC4uLmFyZ3MpXG4gIGNvbnN0IHtcbiAgICByZWRhY3QsXG4gICAgY3JsZixcbiAgICBzZXJpYWxpemVycyxcbiAgICB0aW1lc3RhbXAsXG4gICAgbWVzc2FnZUtleSxcbiAgICBiYXNlLFxuICAgIG5hbWUsXG4gICAgbGV2ZWwsXG4gICAgY3VzdG9tTGV2ZWxzLFxuICAgIHVzZUxldmVsTGFiZWxzLFxuICAgIGNoYW5nZUxldmVsTmFtZSxcbiAgICB1c2VPbmx5Q3VzdG9tTGV2ZWxzXG4gIH0gPSBvcHRzXG5cbiAgY29uc3Qgc3RyaW5naWZpZXJzID0gcmVkYWN0ID8gcmVkYWN0aW9uKHJlZGFjdCwgc3RyaW5naWZ5KSA6IHt9XG4gIGNvbnN0IGZvcm1hdE9wdHMgPSByZWRhY3RcbiAgICA/IHsgc3RyaW5naWZ5OiBzdHJpbmdpZmllcnNbcmVkYWN0Rm10U3ltXSB9XG4gICAgOiB7IHN0cmluZ2lmeSB9XG4gIGNvbnN0IG1lc3NhZ2VLZXlTdHJpbmcgPSBgLFwiJHttZXNzYWdlS2V5fVwiOmBcbiAgY29uc3QgZW5kID0gJyxcInZcIjonICsgTE9HX1ZFUlNJT04gKyAnfScgKyAoY3JsZiA/ICdcXHJcXG4nIDogJ1xcbicpXG4gIGNvbnN0IGNvcmVDaGluZGluZ3MgPSBhc0NoaW5kaW5ncy5iaW5kKG51bGwsIHtcbiAgICBbY2hpbmRpbmdzU3ltXTogJycsXG4gICAgW3NlcmlhbGl6ZXJzU3ltXTogc2VyaWFsaXplcnMsXG4gICAgW3N0cmluZ2lmaWVyc1N5bV06IHN0cmluZ2lmaWVycyxcbiAgICBbc3RyaW5naWZ5U3ltXTogc3RyaW5naWZ5XG4gIH0pXG4gIGNvbnN0IGNoaW5kaW5ncyA9IGJhc2UgPT09IG51bGwgPyAnJyA6IChuYW1lID09PSB1bmRlZmluZWQpXG4gICAgPyBjb3JlQ2hpbmRpbmdzKGJhc2UpIDogY29yZUNoaW5kaW5ncyhPYmplY3QuYXNzaWduKHt9LCBiYXNlLCB7IG5hbWUgfSkpXG4gIGNvbnN0IHRpbWUgPSAodGltZXN0YW1wIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgPyB0aW1lc3RhbXAgOiAodGltZXN0YW1wID8gZXBvY2hUaW1lIDogbnVsbFRpbWUpXG5cbiAgaWYgKHVzZU9ubHlDdXN0b21MZXZlbHMgJiYgIWN1c3RvbUxldmVscykgdGhyb3cgRXJyb3IoJ2N1c3RvbUxldmVscyBpcyByZXF1aXJlZCBpZiB1c2VPbmx5Q3VzdG9tTGV2ZWxzIGlzIHNldCB0cnVlJylcblxuICBhc3NlcnREZWZhdWx0TGV2ZWxGb3VuZChsZXZlbCwgY3VzdG9tTGV2ZWxzLCB1c2VPbmx5Q3VzdG9tTGV2ZWxzKVxuICBjb25zdCBsZXZlbHMgPSBtYXBwaW5ncyhjdXN0b21MZXZlbHMsIHVzZU9ubHlDdXN0b21MZXZlbHMpXG5cbiAgY29uc3QgaW5zdGFuY2UgPSB7XG4gICAgbGV2ZWxzLFxuICAgIFt1c2VMZXZlbExhYmVsc1N5bV06IHVzZUxldmVsTGFiZWxzLFxuICAgIFtjaGFuZ2VMZXZlbE5hbWVTeW1dOiBjaGFuZ2VMZXZlbE5hbWUsXG4gICAgW3VzZU9ubHlDdXN0b21MZXZlbHNTeW1dOiB1c2VPbmx5Q3VzdG9tTGV2ZWxzLFxuICAgIFtzdHJlYW1TeW1dOiBzdHJlYW0sXG4gICAgW3RpbWVTeW1dOiB0aW1lLFxuICAgIFtzdHJpbmdpZnlTeW1dOiBzdHJpbmdpZnksXG4gICAgW3N0cmluZ2lmaWVyc1N5bV06IHN0cmluZ2lmaWVycyxcbiAgICBbZW5kU3ltXTogZW5kLFxuICAgIFtmb3JtYXRPcHRzU3ltXTogZm9ybWF0T3B0cyxcbiAgICBbbWVzc2FnZUtleVN0cmluZ1N5bV06IG1lc3NhZ2VLZXlTdHJpbmcsXG4gICAgW3NlcmlhbGl6ZXJzU3ltXTogc2VyaWFsaXplcnMsXG4gICAgW2NoaW5kaW5nc1N5bV06IGNoaW5kaW5nc1xuICB9XG4gIE9iamVjdC5zZXRQcm90b3R5cGVPZihpbnN0YW5jZSwgcHJvdG8pXG5cbiAgaWYgKGN1c3RvbUxldmVscyB8fCB1c2VMZXZlbExhYmVscyB8fCBjaGFuZ2VMZXZlbE5hbWUgIT09IGRlZmF1bHRPcHRpb25zLmNoYW5nZUxldmVsTmFtZSkgZ2VuTHNDYWNoZShpbnN0YW5jZSlcblxuICBpbnN0YW5jZVtzZXRMZXZlbFN5bV0obGV2ZWwpXG5cbiAgcmV0dXJuIGluc3RhbmNlXG59XG5cbnBpbm8uZXh0cmVtZSA9IChkZXN0ID0gcHJvY2Vzcy5zdGRvdXQuZmQpID0+IGJ1aWxkU2FmZVNvbmljQm9vbShkZXN0LCA0MDk2LCBmYWxzZSlcbnBpbm8uZGVzdGluYXRpb24gPSAoZGVzdCA9IHByb2Nlc3Muc3Rkb3V0LmZkKSA9PiBidWlsZFNhZmVTb25pY0Jvb20oZGVzdCwgMCwgdHJ1ZSlcblxucGluby5maW5hbCA9IGZpbmFsXG5waW5vLmxldmVscyA9IG1hcHBpbmdzKClcbnBpbm8uc3RkU2VyaWFsaXplcnMgPSBzZXJpYWxpemVyc1xucGluby5zdGRUaW1lRnVuY3Rpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgdGltZSlcbnBpbm8uc3ltYm9scyA9IHN5bWJvbHNcbnBpbm8udmVyc2lvbiA9IHZlcnNpb25cbnBpbm8uTE9HX1ZFUlNJT04gPSBMT0dfVkVSU0lPTlxuXG5tb2R1bGUuZXhwb3J0cyA9IHBpbm9cbiIsIi8qXG4gKiAgKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrXG4gKiAgQ29weXJpZ2h0IDIwMTkgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqICBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuICogICsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrK1xuICovXG5cbmNvbnN0IHt0b2RheU5hbWV9ID0gcmVxdWlyZSgnLi9jb21wb25lbnRzL3V0aWxzJyk7XG5jb25zdCB7VGltZX0gPSByZXF1aXJlKCcuL3NlcnZpY2VzL3RpbWUuc2VydmljZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICB0b2RheU5hbWUsXG4gICAgZ2V0RGF5OiBUaW1lLnNlcnZlclRpbWVHZXREYXlcbn07XG5cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IGVyclNlcmlhbGl6ZXJcblxuY29uc3Qgc2VlbiA9IFN5bWJvbCgnY2lyY3VsYXItcmVmLXRhZycpXG5jb25zdCByYXdTeW1ib2wgPSBTeW1ib2woJ3Bpbm8tcmF3LWVyci1yZWYnKVxuY29uc3QgcGlub0VyclByb3RvID0gT2JqZWN0LmNyZWF0ZSh7fSwge1xuICB0eXBlOiB7XG4gICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogdW5kZWZpbmVkXG4gIH0sXG4gIG1lc3NhZ2U6IHtcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgIHZhbHVlOiB1bmRlZmluZWRcbiAgfSxcbiAgc3RhY2s6IHtcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgIHZhbHVlOiB1bmRlZmluZWRcbiAgfSxcbiAgcmF3OiB7XG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gdGhpc1tyYXdTeW1ib2xdXG4gICAgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uICh2YWwpIHtcbiAgICAgIHRoaXNbcmF3U3ltYm9sXSA9IHZhbFxuICAgIH1cbiAgfVxufSlcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShwaW5vRXJyUHJvdG8sIHJhd1N5bWJvbCwge1xuICB3cml0YWJsZTogdHJ1ZSxcbiAgdmFsdWU6IHt9XG59KVxuXG5mdW5jdGlvbiBlcnJTZXJpYWxpemVyIChlcnIpIHtcbiAgaWYgKCEoZXJyIGluc3RhbmNlb2YgRXJyb3IpKSB7XG4gICAgcmV0dXJuIGVyclxuICB9XG5cbiAgZXJyW3NlZW5dID0gdW5kZWZpbmVkIC8vIHRhZyB0byBwcmV2ZW50IHJlLWxvb2tpbmcgYXQgdGhpc1xuICBjb25zdCBfZXJyID0gT2JqZWN0LmNyZWF0ZShwaW5vRXJyUHJvdG8pXG4gIF9lcnIudHlwZSA9IGVyci5jb25zdHJ1Y3Rvci5uYW1lXG4gIF9lcnIubWVzc2FnZSA9IGVyci5tZXNzYWdlXG4gIF9lcnIuc3RhY2sgPSBlcnIuc3RhY2tcbiAgZm9yIChjb25zdCBrZXkgaW4gZXJyKSB7XG4gICAgaWYgKF9lcnJba2V5XSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCB2YWwgPSBlcnJba2V5XVxuICAgICAgaWYgKHZhbCBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIGlmICghdmFsLmhhc093blByb3BlcnR5KHNlZW4pKSB7XG4gICAgICAgICAgX2VycltrZXldID0gZXJyU2VyaWFsaXplcih2YWwpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIF9lcnJba2V5XSA9IHZhbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGRlbGV0ZSBlcnJbc2Vlbl0gLy8gY2xlYW4gdXAgdGFnIGluIGNhc2UgZXJyIGlzIHNlcmlhbGl6ZWQgYWdhaW4gbGF0ZXJcbiAgX2Vyci5yYXcgPSBlcnJcbiAgcmV0dXJuIF9lcnJcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbWFwSHR0cFJlcXVlc3QsXG4gIHJlcVNlcmlhbGl6ZXJcbn1cblxudmFyIHJhd1N5bWJvbCA9IFN5bWJvbCgncGluby1yYXctcmVxLXJlZicpXG52YXIgcGlub1JlcVByb3RvID0gT2JqZWN0LmNyZWF0ZSh7fSwge1xuICBpZDoge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6ICcnXG4gIH0sXG4gIG1ldGhvZDoge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6ICcnXG4gIH0sXG4gIHVybDoge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6ICcnXG4gIH0sXG4gIGhlYWRlcnM6IHtcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgIHZhbHVlOiB7fVxuICB9LFxuICByZW1vdGVBZGRyZXNzOiB7XG4gICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICB2YWx1ZTogJydcbiAgfSxcbiAgcmVtb3RlUG9ydDoge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6ICcnXG4gIH0sXG4gIHJhdzoge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHRoaXNbcmF3U3ltYm9sXVxuICAgIH0sXG4gICAgc2V0OiBmdW5jdGlvbiAodmFsKSB7XG4gICAgICB0aGlzW3Jhd1N5bWJvbF0gPSB2YWxcbiAgICB9XG4gIH1cbn0pXG5PYmplY3QuZGVmaW5lUHJvcGVydHkocGlub1JlcVByb3RvLCByYXdTeW1ib2wsIHtcbiAgd3JpdGFibGU6IHRydWUsXG4gIHZhbHVlOiB7fVxufSlcblxuZnVuY3Rpb24gcmVxU2VyaWFsaXplciAocmVxKSB7XG4gIC8vIHJlcS5pbmZvIGlzIGZvciBoYXBpIGNvbXBhdC5cbiAgdmFyIGNvbm5lY3Rpb24gPSByZXEuaW5mbyB8fCByZXEuY29ubmVjdGlvblxuICBjb25zdCBfcmVxID0gT2JqZWN0LmNyZWF0ZShwaW5vUmVxUHJvdG8pXG4gIF9yZXEuaWQgPSAodHlwZW9mIHJlcS5pZCA9PT0gJ2Z1bmN0aW9uJyA/IHJlcS5pZCgpIDogKHJlcS5pZCB8fCAocmVxLmluZm8gPyByZXEuaW5mby5pZCA6IHVuZGVmaW5lZCkpKVxuICBfcmVxLm1ldGhvZCA9IHJlcS5tZXRob2RcbiAgLy8gcmVxLm9yaWdpbmFsVXJsIGlzIGZvciBleHByZXNzanMgY29tcGF0LlxuICBpZiAocmVxLm9yaWdpbmFsVXJsKSB7XG4gICAgX3JlcS51cmwgPSByZXEub3JpZ2luYWxVcmxcbiAgfSBlbHNlIHtcbiAgICAvLyByZXEudXJsLnBhdGggaXMgIGZvciBoYXBpIGNvbXBhdC5cbiAgICBfcmVxLnVybCA9IHJlcS51cmwgPyAocmVxLnVybC5wYXRoIHx8IHJlcS51cmwpIDogdW5kZWZpbmVkXG4gIH1cbiAgX3JlcS5oZWFkZXJzID0gcmVxLmhlYWRlcnNcbiAgX3JlcS5yZW1vdGVBZGRyZXNzID0gY29ubmVjdGlvbiAmJiBjb25uZWN0aW9uLnJlbW90ZUFkZHJlc3NcbiAgX3JlcS5yZW1vdGVQb3J0ID0gY29ubmVjdGlvbiAmJiBjb25uZWN0aW9uLnJlbW90ZVBvcnRcbiAgLy8gcmVxLnJhdyBpcyAgZm9yIGhhcGkgY29tcGF0L2VxdWl2YWxlbmNlXG4gIF9yZXEucmF3ID0gcmVxLnJhdyB8fCByZXFcbiAgcmV0dXJuIF9yZXFcbn1cblxuZnVuY3Rpb24gbWFwSHR0cFJlcXVlc3QgKHJlcSkge1xuICByZXR1cm4ge1xuICAgIHJlcTogcmVxU2VyaWFsaXplcihyZXEpXG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbWFwSHR0cFJlc3BvbnNlLFxuICByZXNTZXJpYWxpemVyXG59XG5cbnZhciByYXdTeW1ib2wgPSBTeW1ib2woJ3Bpbm8tcmF3LXJlcy1yZWYnKVxudmFyIHBpbm9SZXNQcm90byA9IE9iamVjdC5jcmVhdGUoe30sIHtcbiAgc3RhdHVzQ29kZToge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6IDBcbiAgfSxcbiAgaGVhZGVyczoge1xuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgd3JpdGFibGU6IHRydWUsXG4gICAgdmFsdWU6ICcnXG4gIH0sXG4gIHJhdzoge1xuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHRoaXNbcmF3U3ltYm9sXVxuICAgIH0sXG4gICAgc2V0OiBmdW5jdGlvbiAodmFsKSB7XG4gICAgICB0aGlzW3Jhd1N5bWJvbF0gPSB2YWxcbiAgICB9XG4gIH1cbn0pXG5PYmplY3QuZGVmaW5lUHJvcGVydHkocGlub1Jlc1Byb3RvLCByYXdTeW1ib2wsIHtcbiAgd3JpdGFibGU6IHRydWUsXG4gIHZhbHVlOiB7fVxufSlcblxuZnVuY3Rpb24gcmVzU2VyaWFsaXplciAocmVzKSB7XG4gIGNvbnN0IF9yZXMgPSBPYmplY3QuY3JlYXRlKHBpbm9SZXNQcm90bylcbiAgX3Jlcy5zdGF0dXNDb2RlID0gcmVzLnN0YXR1c0NvZGVcbiAgX3Jlcy5oZWFkZXJzID0gcmVzLmdldEhlYWRlcnMgPyByZXMuZ2V0SGVhZGVycygpIDogcmVzLl9oZWFkZXJzXG4gIF9yZXMucmF3ID0gcmVzXG4gIHJldHVybiBfcmVzXG59XG5cbmZ1bmN0aW9uIG1hcEh0dHBSZXNwb25zZSAocmVzKSB7XG4gIHJldHVybiB7XG4gICAgcmVzOiByZXNTZXJpYWxpemVyKHJlcylcbiAgfVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IGZhc3RSZWRhY3QgPSByZXF1aXJlKCdmYXN0LXJlZGFjdCcpXG5jb25zdCB7IHJlZGFjdEZtdFN5bSB9ID0gcmVxdWlyZSgnLi9zeW1ib2xzJylcbmNvbnN0IHsgcngsIHZhbGlkYXRvciB9ID0gZmFzdFJlZGFjdFxuXG5jb25zdCB2YWxpZGF0ZSA9IHZhbGlkYXRvcih7XG4gIEVSUl9QQVRIU19NVVNUX0JFX1NUUklOR1M6ICgpID0+ICdwaW5vIOKAkyByZWRhY3RlZCBwYXRocyBtdXN0IGJlIHN0cmluZ3MnLFxuICBFUlJfSU5WQUxJRF9QQVRIOiAocykgPT4gYHBpbm8g4oCTIHJlZGFjdCBwYXRocyBhcnJheSBjb250YWlucyBhbiBpbnZhbGlkIHBhdGggKCR7c30pYFxufSlcblxuY29uc3QgQ0VOU09SID0gJ1tSZWRhY3RlZF0nXG5jb25zdCBzdHJpY3QgPSBmYWxzZSAvLyBUT0RPIHNob3VsZCB0aGlzIGJlIGNvbmZpZ3VyYWJsZT9cblxuZnVuY3Rpb24gcmVkYWN0aW9uIChvcHRzLCBzZXJpYWxpemUpIHtcbiAgY29uc3QgeyBwYXRocywgY2Vuc29yIH0gPSBoYW5kbGUob3B0cylcblxuICBjb25zdCBzaGFwZSA9IHBhdGhzLnJlZHVjZSgobywgc3RyKSA9PiB7XG4gICAgcngubGFzdEluZGV4ID0gMFxuICAgIHJ4LmV4ZWMoc3RyKVxuICAgIGNvbnN0IG5leHQgPSByeC5leGVjKHN0cilcbiAgICAvLyB0b3AgbGV2ZWwga2V5OlxuICAgIGlmIChuZXh0ID09PSBudWxsKSB7XG4gICAgICBvW3N0cl0gPSBudWxsXG4gICAgICByZXR1cm4gb1xuICAgIH1cbiAgICBjb25zdCB7IGluZGV4IH0gPSBuZXh0XG4gICAgY29uc3QgZmlyc3RQb3NCcmFja2V0ID0gc3RyW2luZGV4IC0gMV0gPT09ICdbJ1xuICAgIGNvbnN0IGxlYWRpbmdDaGFyID0gZmlyc3RQb3NCcmFja2V0ID8gJ1snIDogJydcbiAgICBjb25zdCBucyA9IHN0ci5zdWJzdHIoMCwgaW5kZXggLSAxKS5yZXBsYWNlKC9eXFxbXCIoLispXCJcXF0kLywgJyQxJylcbiAgICBvW25zXSA9IG9bbnNdIHx8IFtdXG4gICAgb1tuc10ucHVzaChgJHtsZWFkaW5nQ2hhcn0ke3N0ci5zdWJzdHIoaW5kZXgsIHN0ci5sZW5ndGggLSAxKX1gKVxuICAgIHJldHVybiBvXG4gIH0sIHt9KVxuXG4gIC8vIHRoZSByZWRhY3RvciBhc3NpZ25lZCB0byB0aGUgZm9ybWF0IHN5bWJvbCBrZXlcbiAgLy8gcHJvdmlkZXMgdG9wIGxldmVsIHJlZGFjdGlvbiBmb3IgaW5zdGFuY2VzIHdoZXJlXG4gIC8vIGFuIG9iamVjdCBpcyBpbnRlcnBvbGF0ZWQgaW50byB0aGUgbXNnIHN0cmluZ1xuICBjb25zdCByZXN1bHQgPSB7XG4gICAgW3JlZGFjdEZtdFN5bV06IGZhc3RSZWRhY3QoeyBwYXRocywgY2Vuc29yLCBzZXJpYWxpemUsIHN0cmljdCB9KVxuICB9XG4gIGNvbnN0IHNlcmlhbGl6ZWRDZW5zb3IgPSBzZXJpYWxpemUoY2Vuc29yKVxuICBjb25zdCB0b3BDZW5zb3IgPSAoKSA9PiBzZXJpYWxpemVkQ2Vuc29yXG4gIHJldHVybiBPYmplY3Qua2V5cyhzaGFwZSkucmVkdWNlKChvLCBrKSA9PiB7XG4gICAgLy8gdG9wIGxldmVsIGtleTpcbiAgICBpZiAoc2hhcGVba10gPT09IG51bGwpIG9ba10gPSB0b3BDZW5zb3JcbiAgICBlbHNlIG9ba10gPSBmYXN0UmVkYWN0KHsgcGF0aHM6IHNoYXBlW2tdLCBjZW5zb3IsIHNlcmlhbGl6ZSwgc3RyaWN0IH0pXG4gICAgcmV0dXJuIG9cbiAgfSwgcmVzdWx0KVxufVxuXG5mdW5jdGlvbiBoYW5kbGUgKG9wdHMpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkob3B0cykpIHtcbiAgICBvcHRzID0geyBwYXRoczogb3B0cywgY2Vuc29yOiBDRU5TT1IgfVxuICAgIHZhbGlkYXRlKG9wdHMpXG4gICAgcmV0dXJuIG9wdHNcbiAgfVxuICB2YXIgeyBwYXRocywgY2Vuc29yID0gQ0VOU09SLCByZW1vdmUgfSA9IG9wdHNcbiAgaWYgKEFycmF5LmlzQXJyYXkocGF0aHMpID09PSBmYWxzZSkgeyB0aHJvdyBFcnJvcigncGlubyDigJMgcmVkYWN0IG11c3QgY29udGFpbiBhbiBhcnJheSBvZiBzdHJpbmdzJykgfVxuICBpZiAocmVtb3ZlID09PSB0cnVlKSBjZW5zb3IgPSB1bmRlZmluZWRcbiAgdmFsaWRhdGUoeyBwYXRocywgY2Vuc29yIH0pXG5cbiAgcmV0dXJuIHsgcGF0aHMsIGNlbnNvciB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcmVkYWN0aW9uXG4iLCIndXNlIHN0cmljdCdcblxuY29uc3QgdmFsaWRhdG9yID0gcmVxdWlyZSgnLi9saWIvdmFsaWRhdG9yJylcbmNvbnN0IHBhcnNlID0gcmVxdWlyZSgnLi9saWIvcGFyc2UnKVxuY29uc3QgcmVkYWN0b3IgPSByZXF1aXJlKCcuL2xpYi9yZWRhY3RvcicpXG5jb25zdCByZXN0b3JlciA9IHJlcXVpcmUoJy4vbGliL3Jlc3RvcmVyJylcbmNvbnN0IHsgZ3JvdXBSZWRhY3QsIG5lc3RlZFJlZGFjdCB9ID0gcmVxdWlyZSgnLi9saWIvbW9kaWZpZXJzJylcbmNvbnN0IHN0YXRlID0gcmVxdWlyZSgnLi9saWIvc3RhdGUnKVxuY29uc3QgcnggPSByZXF1aXJlKCcuL2xpYi9yeCcpXG5jb25zdCB2YWxpZGF0ZSA9IHZhbGlkYXRvcigpXG5jb25zdCBub29wID0gKG8pID0+IG9cbm5vb3AucmVzdG9yZSA9IG5vb3BcblxuY29uc3QgREVGQVVMVF9DRU5TT1IgPSAnW1JFREFDVEVEXSdcbmZhc3RSZWRhY3QucnggPSByeFxuZmFzdFJlZGFjdC52YWxpZGF0b3IgPSB2YWxpZGF0b3JcblxubW9kdWxlLmV4cG9ydHMgPSBmYXN0UmVkYWN0XG5cbmZ1bmN0aW9uIGZhc3RSZWRhY3QgKG9wdHMgPSB7fSkge1xuICBjb25zdCBwYXRocyA9IEFycmF5LmZyb20obmV3IFNldChvcHRzLnBhdGhzIHx8IFtdKSlcbiAgY29uc3Qgc2VyaWFsaXplID0gJ3NlcmlhbGl6ZScgaW4gb3B0cyA/IChcbiAgICBvcHRzLnNlcmlhbGl6ZSA9PT0gZmFsc2UgPyBvcHRzLnNlcmlhbGl6ZVxuICAgICAgOiAodHlwZW9mIG9wdHMuc2VyaWFsaXplID09PSAnZnVuY3Rpb24nID8gb3B0cy5zZXJpYWxpemUgOiBKU09OLnN0cmluZ2lmeSlcbiAgKSA6IEpTT04uc3RyaW5naWZ5XG4gIGNvbnN0IHJlbW92ZSA9IG9wdHMucmVtb3ZlXG4gIGlmIChyZW1vdmUgPT09IHRydWUgJiYgc2VyaWFsaXplICE9PSBKU09OLnN0cmluZ2lmeSkge1xuICAgIHRocm93IEVycm9yKCdmYXN0LXJlZGFjdCDigJMgcmVtb3ZlIG9wdGlvbiBtYXkgb25seSBiZSBzZXQgd2hlbiBzZXJpYWxpemVyIGlzIEpTT04uc3RyaW5naWZ5JylcbiAgfVxuICBjb25zdCBjZW5zb3IgPSByZW1vdmUgPT09IHRydWVcbiAgICA/IHVuZGVmaW5lZFxuICAgIDogJ2NlbnNvcicgaW4gb3B0cyA/IG9wdHMuY2Vuc29yIDogREVGQVVMVF9DRU5TT1JcblxuICBjb25zdCBpc0NlbnNvckZjdCA9IHR5cGVvZiBjZW5zb3IgPT09ICdmdW5jdGlvbidcblxuICBpZiAocGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gc2VyaWFsaXplIHx8IG5vb3BcblxuICB2YWxpZGF0ZSh7IHBhdGhzLCBzZXJpYWxpemUsIGNlbnNvciB9KVxuXG4gIGNvbnN0IHsgd2lsZGNhcmRzLCB3Y0xlbiwgc2VjcmV0IH0gPSBwYXJzZSh7IHBhdGhzLCBjZW5zb3IgfSlcblxuICBjb25zdCBjb21waWxlUmVzdG9yZSA9IHJlc3RvcmVyKHsgc2VjcmV0LCB3Y0xlbiB9KVxuICBjb25zdCBzdHJpY3QgPSAnc3RyaWN0JyBpbiBvcHRzID8gb3B0cy5zdHJpY3QgOiB0cnVlXG5cbiAgcmV0dXJuIHJlZGFjdG9yKHsgc2VjcmV0LCB3Y0xlbiwgc2VyaWFsaXplLCBzdHJpY3QsIGlzQ2Vuc29yRmN0IH0sIHN0YXRlKHtcbiAgICBzZWNyZXQsXG4gICAgY2Vuc29yLFxuICAgIGNvbXBpbGVSZXN0b3JlLFxuICAgIHNlcmlhbGl6ZSxcbiAgICBncm91cFJlZGFjdCxcbiAgICBuZXN0ZWRSZWRhY3QsXG4gICAgd2lsZGNhcmRzLFxuICAgIHdjTGVuXG4gIH0pKVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IHsgY3JlYXRlQ29udGV4dCwgcnVuSW5Db250ZXh0IH0gPSByZXF1aXJlKCd2bScpXG5cbm1vZHVsZS5leHBvcnRzID0gdmFsaWRhdG9yXG5cbmZ1bmN0aW9uIHZhbGlkYXRvciAob3B0cyA9IHt9KSB7XG4gIGNvbnN0IHtcbiAgICBFUlJfUEFUSFNfTVVTVF9CRV9TVFJJTkdTID0gKCkgPT4gJ2Zhc3QtcmVkYWN0IC0gUGF0aHMgbXVzdCBiZSBzdHJpbmdzJyxcbiAgICBFUlJfSU5WQUxJRF9QQVRIID0gKHMpID0+IGBmYXN0LXJlZGFjdCDigJMgSW52YWxpZCBwYXRoICgke3N9KWBcbiAgfSA9IG9wdHNcblxuICByZXR1cm4gZnVuY3Rpb24gdmFsaWRhdGUgKHsgcGF0aHMgfSkge1xuICAgIHBhdGhzLmZvckVhY2goKHMpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgcyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoRVJSX1BBVEhTX01VU1RfQkVfU1RSSU5HUygpKVxuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKC/jgIcvLnRlc3QocykpIHRocm93IEVycm9yKClcbiAgICAgICAgY29uc3QgcHJveHkgPSBuZXcgUHJveHkoe30sIHsgZ2V0OiAoKSA9PiBwcm94eSwgc2V0OiAoKSA9PiB7IHRocm93IEVycm9yKCkgfSB9KVxuICAgICAgICBjb25zdCBleHByID0gKHNbMF0gPT09ICdbJyA/ICcnIDogJy4nKSArIHMucmVwbGFjZSgvXlxcKi8sICfjgIcnKS5yZXBsYWNlKC9cXC5cXCovZywgJy7jgIcnKS5yZXBsYWNlKC9cXFtcXCpcXF0vZywgJ1vjgIddJylcbiAgICAgICAgaWYgKC9cXG58XFxyfDsvLnRlc3QoZXhwcikpIHRocm93IEVycm9yKClcbiAgICAgICAgaWYgKC9cXC9cXCovLnRlc3QoZXhwcikpIHRocm93IEVycm9yKClcbiAgICAgICAgcnVuSW5Db250ZXh0KGBcbiAgICAgICAgICAoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJ3VzZSBzdHJpY3QnXG4gICAgICAgICAgICBvJHtleHByfVxuICAgICAgICAgICAgaWYgKFtvJHtleHByfV0ubGVuZ3RoICE9PSAxKSB0aHJvdyBFcnJvcigpXG4gICAgICAgICAgfSkoKVxuICAgICAgICBgLCBjcmVhdGVDb250ZXh0KHsgbzogcHJveHksIOOAhzogbnVsbCB9KSwge1xuICAgICAgICAgIGNvZGVHZW5lcmF0aW9uOiB7IHN0cmluZ3M6IGZhbHNlLCB3YXNtOiBmYWxzZSB9XG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRocm93IEVycm9yKEVSUl9JTlZBTElEX1BBVEgocykpXG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwidm1cIik7IiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IHJ4ID0gcmVxdWlyZSgnLi9yeCcpXG5cbm1vZHVsZS5leHBvcnRzID0gcGFyc2VcblxuZnVuY3Rpb24gcGFyc2UgKHsgcGF0aHMgfSkge1xuICBjb25zdCB3aWxkY2FyZHMgPSBbXVxuICB2YXIgd2NMZW4gPSAwXG4gIGNvbnN0IHNlY3JldCA9IHBhdGhzLnJlZHVjZShmdW5jdGlvbiAobywgc3RyUGF0aCwgaXgpIHtcbiAgICB2YXIgcGF0aCA9IHN0clBhdGgubWF0Y2gocngpLm1hcCgocCkgPT4gcC5yZXBsYWNlKC8nfFwifGAvZywgJycpKVxuICAgIGNvbnN0IGxlYWRpbmdCcmFja2V0ID0gc3RyUGF0aFswXSA9PT0gJ1snXG4gICAgcGF0aCA9IHBhdGgubWFwKChwKSA9PiB7XG4gICAgICBpZiAocFswXSA9PT0gJ1snKSByZXR1cm4gcC5zdWJzdHIoMSwgcC5sZW5ndGggLSAyKVxuICAgICAgZWxzZSByZXR1cm4gcFxuICAgIH0pXG4gICAgY29uc3Qgc3RhciA9IHBhdGguaW5kZXhPZignKicpXG4gICAgaWYgKHN0YXIgPiAtMSkge1xuICAgICAgY29uc3QgYmVmb3JlID0gcGF0aC5zbGljZSgwLCBzdGFyKVxuICAgICAgY29uc3QgYmVmb3JlU3RyID0gYmVmb3JlLmpvaW4oJy4nKVxuICAgICAgY29uc3QgYWZ0ZXIgPSBwYXRoLnNsaWNlKHN0YXIgKyAxLCBwYXRoLmxlbmd0aClcbiAgICAgIGlmIChhZnRlci5pbmRleE9mKCcqJykgPiAtMSkgdGhyb3cgRXJyb3IoJ2Zhc3QtcmVkYWN0IOKAkyBPbmx5IG9uZSB3aWxkY2FyZCBwZXIgcGF0aCBpcyBzdXBwb3J0ZWQnKVxuICAgICAgY29uc3QgbmVzdGVkID0gYWZ0ZXIubGVuZ3RoID4gMFxuICAgICAgd2NMZW4rK1xuICAgICAgd2lsZGNhcmRzLnB1c2goe1xuICAgICAgICBiZWZvcmUsXG4gICAgICAgIGJlZm9yZVN0cixcbiAgICAgICAgYWZ0ZXIsXG4gICAgICAgIG5lc3RlZFxuICAgICAgfSlcbiAgICB9IGVsc2Uge1xuICAgICAgb1tzdHJQYXRoXSA9IHtcbiAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgdmFsOiB1bmRlZmluZWQsXG4gICAgICAgIHByZWNlbnNvcmVkOiBmYWxzZSxcbiAgICAgICAgY2lyY2xlOiAnJyxcbiAgICAgICAgZXNjUGF0aDogSlNPTi5zdHJpbmdpZnkoc3RyUGF0aCksXG4gICAgICAgIGxlYWRpbmdCcmFja2V0OiBsZWFkaW5nQnJhY2tldFxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb1xuICB9LCB7fSlcblxuICByZXR1cm4geyB3aWxkY2FyZHMsIHdjTGVuLCBzZWNyZXQgfVxufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbmNvbnN0IHJ4ID0gcmVxdWlyZSgnLi9yeCcpXG5cbm1vZHVsZS5leHBvcnRzID0gcmVkYWN0b3JcblxuZnVuY3Rpb24gcmVkYWN0b3IgKHsgc2VjcmV0LCBzZXJpYWxpemUsIHdjTGVuLCBzdHJpY3QsIGlzQ2Vuc29yRmN0IH0sIHN0YXRlKSB7XG4gIC8qIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSAqL1xuICBjb25zdCByZWRhY3QgPSBGdW5jdGlvbignbycsIGBcbiAgICBpZiAodHlwZW9mIG8gIT09ICdvYmplY3QnIHx8IG8gPT0gbnVsbCkge1xuICAgICAgJHtzdHJpY3RJbXBsKHN0cmljdCwgc2VyaWFsaXplKX1cbiAgICB9XG4gICAgY29uc3QgeyBjZW5zb3IsIHNlY3JldCB9ID0gdGhpc1xuICAgICR7cmVkYWN0VG1wbChzZWNyZXQsIGlzQ2Vuc29yRmN0KX1cbiAgICB0aGlzLmNvbXBpbGVSZXN0b3JlKClcbiAgICAke2R5bmFtaWNSZWRhY3RUbXBsKHdjTGVuID4gMCwgaXNDZW5zb3JGY3QpfVxuICAgICR7cmVzdWx0VG1wbChzZXJpYWxpemUpfVxuICBgKS5iaW5kKHN0YXRlKVxuXG4gIGlmIChzZXJpYWxpemUgPT09IGZhbHNlKSB7XG4gICAgcmVkYWN0LnJlc3RvcmUgPSAobykgPT4gc3RhdGUucmVzdG9yZShvKVxuICB9XG5cbiAgcmV0dXJuIHJlZGFjdFxufVxuXG5mdW5jdGlvbiByZWRhY3RUbXBsIChzZWNyZXQsIGlzQ2Vuc29yRmN0KSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhzZWNyZXQpLm1hcCgocGF0aCkgPT4ge1xuICAgIGNvbnN0IHsgZXNjUGF0aCwgbGVhZGluZ0JyYWNrZXQgfSA9IHNlY3JldFtwYXRoXVxuICAgIGNvbnN0IHNraXAgPSBsZWFkaW5nQnJhY2tldCA/IDEgOiAwXG4gICAgY29uc3QgZGVsaW0gPSBsZWFkaW5nQnJhY2tldCA/ICcnIDogJy4nXG4gICAgY29uc3QgaG9wcyA9IFtdXG4gICAgdmFyIG1hdGNoXG4gICAgd2hpbGUgKChtYXRjaCA9IHJ4LmV4ZWMocGF0aCkpICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBbICwgaXggXSA9IG1hdGNoXG4gICAgICBjb25zdCB7IGluZGV4LCBpbnB1dCB9ID0gbWF0Y2hcbiAgICAgIGlmIChpbmRleCA+IHNraXApIGhvcHMucHVzaChpbnB1dC5zdWJzdHJpbmcoMCwgaW5kZXggLSAoaXggPyAwIDogMSkpKVxuICAgIH1cbiAgICB2YXIgZXhpc3RlbmNlID0gaG9wcy5tYXAoKHApID0+IGBvJHtkZWxpbX0ke3B9YCkuam9pbignICYmICcpXG4gICAgaWYgKGV4aXN0ZW5jZS5sZW5ndGggPT09IDApIGV4aXN0ZW5jZSArPSBgbyR7ZGVsaW19JHtwYXRofSAhPSBudWxsYFxuICAgIGVsc2UgZXhpc3RlbmNlICs9IGAgJiYgbyR7ZGVsaW19JHtwYXRofSAhPSBudWxsYFxuXG4gICAgY29uc3QgY2lyY3VsYXJEZXRlY3Rpb24gPSBgXG4gICAgICBzd2l0Y2ggKHRydWUpIHtcbiAgICAgICAgJHtob3BzLnJldmVyc2UoKS5tYXAoKHApID0+IGBcbiAgICAgICAgICBjYXNlIG8ke2RlbGltfSR7cH0gPT09IGNlbnNvcjpcbiAgICAgICAgICAgIHNlY3JldFske2VzY1BhdGh9XS5jaXJjbGUgPSAke0pTT04uc3RyaW5naWZ5KHApfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgYCkuam9pbignXFxuJyl9XG4gICAgICB9XG4gICAgYFxuICAgIHJldHVybiBgXG4gICAgICBpZiAoJHtleGlzdGVuY2V9KSB7XG4gICAgICAgIGNvbnN0IHZhbCA9IG8ke2RlbGltfSR7cGF0aH1cbiAgICAgICAgaWYgKHZhbCA9PT0gY2Vuc29yKSB7XG4gICAgICAgICAgc2VjcmV0WyR7ZXNjUGF0aH1dLnByZWNlbnNvcmVkID0gdHJ1ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNlY3JldFske2VzY1BhdGh9XS52YWwgPSB2YWxcbiAgICAgICAgICBvJHtkZWxpbX0ke3BhdGh9ID0gJHtpc0NlbnNvckZjdCA/ICdjZW5zb3IodmFsKScgOiAnY2Vuc29yJ31cbiAgICAgICAgICAke2NpcmN1bGFyRGV0ZWN0aW9ufVxuICAgICAgICB9XG4gICAgICB9XG4gICAgYFxuICB9KS5qb2luKCdcXG4nKVxufVxuXG5mdW5jdGlvbiBkeW5hbWljUmVkYWN0VG1wbCAoaGFzV2lsZGNhcmRzLCBpc0NlbnNvckZjdCkge1xuICByZXR1cm4gaGFzV2lsZGNhcmRzID09PSB0cnVlID8gYFxuICAgIHtcbiAgICAgIGNvbnN0IHsgd2lsZGNhcmRzLCB3Y0xlbiwgZ3JvdXBSZWRhY3QsIG5lc3RlZFJlZGFjdCB9ID0gdGhpc1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB3Y0xlbjsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHsgYmVmb3JlLCBiZWZvcmVTdHIsIGFmdGVyLCBuZXN0ZWQgfSA9IHdpbGRjYXJkc1tpXVxuICAgICAgICBpZiAobmVzdGVkID09PSB0cnVlKSB7XG4gICAgICAgICAgc2VjcmV0W2JlZm9yZVN0cl0gPSBzZWNyZXRbYmVmb3JlU3RyXSB8fCBbXVxuICAgICAgICAgIG5lc3RlZFJlZGFjdChzZWNyZXRbYmVmb3JlU3RyXSwgbywgYmVmb3JlLCBhZnRlciwgY2Vuc29yLCAke2lzQ2Vuc29yRmN0fSlcbiAgICAgICAgfSBlbHNlIHNlY3JldFtiZWZvcmVTdHJdID0gZ3JvdXBSZWRhY3QobywgYmVmb3JlLCBjZW5zb3IsICR7aXNDZW5zb3JGY3R9KVxuICAgICAgfVxuICAgIH1cbiAgYCA6ICcnXG59XG5cbmZ1bmN0aW9uIHJlc3VsdFRtcGwgKHNlcmlhbGl6ZSkge1xuICByZXR1cm4gc2VyaWFsaXplID09PSBmYWxzZSA/IGByZXR1cm4gb2AgOiBgXG4gICAgdmFyIHMgPSB0aGlzLnNlcmlhbGl6ZShvKVxuICAgIHRoaXMucmVzdG9yZShvKVxuICAgIHJldHVybiBzXG4gIGBcbn1cblxuZnVuY3Rpb24gc3RyaWN0SW1wbCAoc3RyaWN0LCBzZXJpYWxpemUpIHtcbiAgcmV0dXJuIHN0cmljdCA9PT0gdHJ1ZVxuICAgID8gYHRocm93IEVycm9yKCdmYXN0LXJlZGFjdDogcHJpbWl0aXZlcyBjYW5ub3QgYmUgcmVkYWN0ZWQnKWBcbiAgICA6IHNlcmlhbGl6ZSA9PT0gZmFsc2UgPyBgcmV0dXJuIG9gIDogYHJldHVybiB0aGlzLnNlcmlhbGl6ZShvKWBcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5jb25zdCB7IGdyb3VwUmVzdG9yZSwgbmVzdGVkUmVzdG9yZSB9ID0gcmVxdWlyZSgnLi9tb2RpZmllcnMnKVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJlc3RvcmVyXG5cbmZ1bmN0aW9uIHJlc3RvcmVyICh7IHNlY3JldCwgd2NMZW4gfSkge1xuICByZXR1cm4gZnVuY3Rpb24gY29tcGlsZVJlc3RvcmUgKCkge1xuICAgIGlmICh0aGlzLnJlc3RvcmUpIHJldHVyblxuICAgIGNvbnN0IHBhdGhzID0gT2JqZWN0LmtleXMoc2VjcmV0KVxuICAgICAgLmZpbHRlcigocGF0aCkgPT4gc2VjcmV0W3BhdGhdLnByZWNlbnNvcmVkID09PSBmYWxzZSlcbiAgICBjb25zdCByZXNldHRlcnMgPSByZXNldFRtcGwoc2VjcmV0LCBwYXRocylcbiAgICBjb25zdCBoYXNXaWxkY2FyZHMgPSB3Y0xlbiA+IDBcbiAgICBjb25zdCBzdGF0ZSA9IGhhc1dpbGRjYXJkcyA/IHsgc2VjcmV0LCBncm91cFJlc3RvcmUsIG5lc3RlZFJlc3RvcmUgfSA6IHsgc2VjcmV0IH1cbiAgICAvKiBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgKi9cbiAgICB0aGlzLnJlc3RvcmUgPSBGdW5jdGlvbihcbiAgICAgICdvJyxcbiAgICAgIHJlc3RvcmVUbXBsKHJlc2V0dGVycywgcGF0aHMsIGhhc1dpbGRjYXJkcylcbiAgICApLmJpbmQoc3RhdGUpXG4gIH1cbn1cblxuLyoqXG4gKiBNdXRhdGVzIHRoZSBvcmlnaW5hbCBvYmplY3QgdG8gYmUgY2Vuc29yZWQgYnkgcmVzdG9yaW5nIGl0cyBvcmlnaW5hbCB2YWx1ZXNcbiAqIHByaW9yIHRvIGNlbnNvcmluZy5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gc2VjcmV0IENvbXBpbGVkIG9iamVjdCBkZXNjcmliaW5nIHdoaWNoIHRhcmdldCBmaWVsZHMgc2hvdWxkXG4gKiBiZSBjZW5zb3JlZCBhbmQgdGhlIGZpZWxkIHN0YXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGhzIFRoZSBsaXN0IG9mIHBhdGhzIHRvIGNlbnNvciBhcyBwcm92aWRlZCBhdFxuICogaW5pdGlhbGl6YXRpb24gdGltZS5cbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBTdHJpbmcgb2YgSmF2YVNjcmlwdCB0byBiZSB1c2VkIGJ5IGBGdW5jdGlvbigpYC4gVGhlXG4gKiBzdHJpbmcgY29tcGlsZXMgdG8gdGhlIGZ1bmN0aW9uIHRoYXQgZG9lcyB0aGUgd29yayBpbiB0aGUgZGVzY3JpcHRpb24uXG4gKi9cbmZ1bmN0aW9uIHJlc2V0VG1wbCAoc2VjcmV0LCBwYXRocykge1xuICByZXR1cm4gcGF0aHMubWFwKChwYXRoKSA9PiB7XG4gICAgY29uc3QgeyBjaXJjbGUsIGVzY1BhdGgsIGxlYWRpbmdCcmFja2V0IH0gPSBzZWNyZXRbcGF0aF1cbiAgICBjb25zdCBkZWxpbSA9IGxlYWRpbmdCcmFja2V0ID8gJycgOiAnLidcbiAgICBjb25zdCByZXNldCA9IGNpcmNsZVxuICAgICAgPyBgby4ke2NpcmNsZX0gPSBzZWNyZXRbJHtlc2NQYXRofV0udmFsYFxuICAgICAgOiBgbyR7ZGVsaW19JHtwYXRofSA9IHNlY3JldFske2VzY1BhdGh9XS52YWxgXG4gICAgY29uc3QgY2xlYXIgPSBgc2VjcmV0WyR7ZXNjUGF0aH1dLnZhbCA9IHVuZGVmaW5lZGBcbiAgICByZXR1cm4gYFxuICAgICAgaWYgKHNlY3JldFske2VzY1BhdGh9XS52YWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0cnkgeyAke3Jlc2V0fSB9IGNhdGNoIChlKSB7fVxuICAgICAgICAke2NsZWFyfVxuICAgICAgfVxuICAgIGBcbiAgfSkuam9pbignJylcbn1cblxuZnVuY3Rpb24gcmVzdG9yZVRtcGwgKHJlc2V0dGVycywgcGF0aHMsIGhhc1dpbGRjYXJkcykge1xuICBjb25zdCBkeW5hbWljUmVzZXQgPSBoYXNXaWxkY2FyZHMgPT09IHRydWUgPyBgXG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHNlY3JldClcbiAgICBjb25zdCBsZW4gPSBrZXlzLmxlbmd0aFxuICAgIGZvciAodmFyIGkgPSAke3BhdGhzLmxlbmd0aH07IGkgPCBsZW47IGkrKykge1xuICAgICAgY29uc3QgayA9IGtleXNbaV1cbiAgICAgIGNvbnN0IG8gPSBzZWNyZXRba11cbiAgICAgIGlmIChvLmZsYXQgPT09IHRydWUpIHRoaXMuZ3JvdXBSZXN0b3JlKG8pXG4gICAgICBlbHNlIHRoaXMubmVzdGVkUmVzdG9yZShvKVxuICAgICAgc2VjcmV0W2tdID0gbnVsbFxuICAgIH1cbiAgYCA6ICcnXG5cbiAgcmV0dXJuIGBcbiAgICBjb25zdCBzZWNyZXQgPSB0aGlzLnNlY3JldFxuICAgICR7cmVzZXR0ZXJzfVxuICAgICR7ZHluYW1pY1Jlc2V0fVxuICAgIHJldHVybiBvXG4gIGBcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IHN0YXRlXG5cbmZ1bmN0aW9uIHN0YXRlIChvKSB7XG4gIGNvbnN0IHtcbiAgICBzZWNyZXQsXG4gICAgY2Vuc29yLFxuICAgIGlzQ2Vuc29yRmN0LFxuICAgIGNvbXBpbGVSZXN0b3JlLFxuICAgIHNlcmlhbGl6ZSxcbiAgICBncm91cFJlZGFjdCxcbiAgICBuZXN0ZWRSZWRhY3QsXG4gICAgd2lsZGNhcmRzLFxuICAgIHdjTGVuXG4gIH0gPSBvXG4gIGNvbnN0IGJ1aWxkZXIgPSBbeyBzZWNyZXQsIGNlbnNvciwgaXNDZW5zb3JGY3QsIGNvbXBpbGVSZXN0b3JlIH1dXG4gIGJ1aWxkZXIucHVzaCh7IHNlY3JldCB9KVxuICBpZiAoc2VyaWFsaXplICE9PSBmYWxzZSkgYnVpbGRlci5wdXNoKHsgc2VyaWFsaXplIH0pXG4gIGlmICh3Y0xlbiA+IDApIGJ1aWxkZXIucHVzaCh7IGdyb3VwUmVkYWN0LCBuZXN0ZWRSZWRhY3QsIHdpbGRjYXJkcywgd2NMZW4gfSlcbiAgcmV0dXJuIE9iamVjdC5hc3NpZ24oLi4uYnVpbGRlcilcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5jb25zdCBudWxsVGltZSA9ICgpID0+ICcnXG5cbmNvbnN0IGVwb2NoVGltZSA9ICgpID0+IGAsXCJ0aW1lXCI6JHtEYXRlLm5vdygpfWBcblxuY29uc3QgdW5peFRpbWUgPSAoKSA9PiBgLFwidGltZVwiOiR7TWF0aC5yb3VuZChEYXRlLm5vdygpIC8gMTAwMC4wKX1gXG5cbm1vZHVsZS5leHBvcnRzID0geyBudWxsVGltZSwgZXBvY2hUaW1lLCB1bml4VGltZSB9XG4iLCIndXNlIHN0cmljdCdcbmNvbnN0IHsgRXZlbnRFbWl0dGVyIH0gPSByZXF1aXJlKCdldmVudHMnKVxuY29uc3QgU29uaWNCb29tID0gcmVxdWlyZSgnc29uaWMtYm9vbScpXG5jb25zdCBmbGF0c3RyID0gcmVxdWlyZSgnZmxhdHN0cicpXG5jb25zdCB7XG4gIGxzQ2FjaGVTeW0sXG4gIGxldmVsVmFsU3ltLFxuICBzZXRMZXZlbFN5bSxcbiAgZ2V0TGV2ZWxTeW0sXG4gIGNoaW5kaW5nc1N5bSxcbiAgYXNKc29uU3ltLFxuICB3cml0ZVN5bSxcbiAgdGltZVN5bSxcbiAgc3RyZWFtU3ltLFxuICBzZXJpYWxpemVyc1N5bSxcbiAgdXNlT25seUN1c3RvbUxldmVsc1N5bSxcbiAgbmVlZHNNZXRhZGF0YUdzeW1cbn0gPSByZXF1aXJlKCcuL3N5bWJvbHMnKVxuY29uc3Qge1xuICBnZXRMZXZlbCxcbiAgc2V0TGV2ZWwsXG4gIGlzTGV2ZWxFbmFibGVkLFxuICBtYXBwaW5ncyxcbiAgaW5pdGlhbExzQ2FjaGUsXG4gIGdlbkxzQ2FjaGUsXG4gIGFzc2VydE5vTGV2ZWxDb2xsaXNpb25zXG59ID0gcmVxdWlyZSgnLi9sZXZlbHMnKVxuY29uc3Qge1xuICBhc0NoaW5kaW5ncyxcbiAgYXNKc29uXG59ID0gcmVxdWlyZSgnLi90b29scycpXG5jb25zdCB7XG4gIHZlcnNpb24sXG4gIExPR19WRVJTSU9OXG59ID0gcmVxdWlyZSgnLi9tZXRhJylcblxuLy8gbm90ZTogdXNlIG9mIGNsYXNzIGlzIHNhdGlyaWNhbFxuY29uc3QgY29uc3RydWN0b3IgPSBjbGFzcyBQaW5vIHt9XG5jb25zdCBwcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yLFxuICBjaGlsZCxcbiAgZmx1c2gsXG4gIGlzTGV2ZWxFbmFibGVkLFxuICB2ZXJzaW9uLFxuICBnZXQgbGV2ZWwgKCkgeyByZXR1cm4gdGhpc1tnZXRMZXZlbFN5bV0oKSB9LFxuICBzZXQgbGV2ZWwgKGx2bCkgeyByZXR1cm4gdGhpc1tzZXRMZXZlbFN5bV0obHZsKSB9LFxuICBnZXQgbGV2ZWxWYWwgKCkgeyByZXR1cm4gdGhpc1tsZXZlbFZhbFN5bV0gfSxcbiAgc2V0IGxldmVsVmFsIChuKSB7IHRocm93IEVycm9yKCdsZXZlbFZhbCBpcyByZWFkLW9ubHknKSB9LFxuICBbbHNDYWNoZVN5bV06IGluaXRpYWxMc0NhY2hlLFxuICBbd3JpdGVTeW1dOiB3cml0ZSxcbiAgW2FzSnNvblN5bV06IGFzSnNvbixcbiAgW2dldExldmVsU3ltXTogZ2V0TGV2ZWwsXG4gIFtzZXRMZXZlbFN5bV06IHNldExldmVsLFxuICBMT0dfVkVSU0lPTlxufVxuXG5PYmplY3Quc2V0UHJvdG90eXBlT2YocHJvdG90eXBlLCBFdmVudEVtaXR0ZXIucHJvdG90eXBlKVxuXG5tb2R1bGUuZXhwb3J0cyA9IHByb3RvdHlwZVxuXG5mdW5jdGlvbiBjaGlsZCAoYmluZGluZ3MpIHtcbiAgY29uc3QgeyBsZXZlbCB9ID0gdGhpc1xuICBjb25zdCBzZXJpYWxpemVycyA9IHRoaXNbc2VyaWFsaXplcnNTeW1dXG4gIGNvbnN0IGNoaW5kaW5ncyA9IGFzQ2hpbmRpbmdzKHRoaXMsIGJpbmRpbmdzKVxuICBjb25zdCBpbnN0YW5jZSA9IE9iamVjdC5jcmVhdGUodGhpcylcbiAgaWYgKGJpbmRpbmdzLmhhc093blByb3BlcnR5KCdzZXJpYWxpemVycycpID09PSB0cnVlKSB7XG4gICAgaW5zdGFuY2Vbc2VyaWFsaXplcnNTeW1dID0gT2JqZWN0LmNyZWF0ZShudWxsKVxuICAgIGZvciAodmFyIGsgaW4gc2VyaWFsaXplcnMpIHtcbiAgICAgIGluc3RhbmNlW3NlcmlhbGl6ZXJzU3ltXVtrXSA9IHNlcmlhbGl6ZXJzW2tdXG4gICAgfVxuICAgIGZvciAodmFyIGJrIGluIGJpbmRpbmdzLnNlcmlhbGl6ZXJzKSB7XG4gICAgICBpbnN0YW5jZVtzZXJpYWxpemVyc1N5bV1bYmtdID0gYmluZGluZ3Muc2VyaWFsaXplcnNbYmtdXG4gICAgfVxuICB9IGVsc2UgaW5zdGFuY2Vbc2VyaWFsaXplcnNTeW1dID0gc2VyaWFsaXplcnNcbiAgaWYgKGJpbmRpbmdzLmhhc093blByb3BlcnR5KCdjdXN0b21MZXZlbHMnKSA9PT0gdHJ1ZSkge1xuICAgIGFzc2VydE5vTGV2ZWxDb2xsaXNpb25zKHRoaXMubGV2ZWxzLCBiaW5kaW5ncy5jdXN0b21MZXZlbHMpXG4gICAgaW5zdGFuY2UubGV2ZWxzID0gbWFwcGluZ3MoYmluZGluZ3MuY3VzdG9tTGV2ZWxzLCBpbnN0YW5jZVt1c2VPbmx5Q3VzdG9tTGV2ZWxzU3ltXSlcbiAgICBnZW5Mc0NhY2hlKGluc3RhbmNlKVxuICB9XG4gIGluc3RhbmNlW2NoaW5kaW5nc1N5bV0gPSBjaGluZGluZ3NcbiAgY29uc3QgY2hpbGRMZXZlbCA9IGJpbmRpbmdzLmxldmVsIHx8IGxldmVsXG4gIGluc3RhbmNlW3NldExldmVsU3ltXShjaGlsZExldmVsKVxuXG4gIHJldHVybiBpbnN0YW5jZVxufVxuXG5mdW5jdGlvbiB3cml0ZSAob2JqLCBtc2csIG51bSkge1xuICBjb25zdCB0ID0gdGhpc1t0aW1lU3ltXSgpXG4gIGNvbnN0IHMgPSB0aGlzW2FzSnNvblN5bV0ob2JqLCBtc2csIG51bSwgdClcbiAgY29uc3Qgc3RyZWFtID0gdGhpc1tzdHJlYW1TeW1dXG4gIGlmIChzdHJlYW1bbmVlZHNNZXRhZGF0YUdzeW1dID09PSB0cnVlKSB7XG4gICAgc3RyZWFtLmxhc3RMZXZlbCA9IG51bVxuICAgIHN0cmVhbS5sYXN0TXNnID0gbXNnXG4gICAgc3RyZWFtLmxhc3RPYmogPSBvYmpcbiAgICBzdHJlYW0ubGFzdFRpbWUgPSB0LnNsaWNlKDgpXG4gICAgc3RyZWFtLmxhc3RMb2dnZXIgPSB0aGlzIC8vIGZvciBjaGlsZCBsb2dnZXJzXG4gIH1cbiAgaWYgKHN0cmVhbSBpbnN0YW5jZW9mIFNvbmljQm9vbSkgc3RyZWFtLndyaXRlKHMpXG4gIGVsc2Ugc3RyZWFtLndyaXRlKGZsYXRzdHIocykpXG59XG5cbmZ1bmN0aW9uIGZsdXNoICgpIHtcbiAgY29uc3Qgc3RyZWFtID0gdGhpc1tzdHJlYW1TeW1dXG4gIGlmICgnZmx1c2gnIGluIHN0cmVhbSkgc3RyZWFtLmZsdXNoKClcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZShcImZzXCIpOyIsIid1c2Ugc3RyaWN0J1xuZnVuY3Rpb24gdHJ5U3RyaW5naWZ5IChvKSB7XG4gIHRyeSB7IHJldHVybiBKU09OLnN0cmluZ2lmeShvKSB9IGNhdGNoKGUpIHsgcmV0dXJuICdcIltDaXJjdWxhcl1cIicgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZvcm1hdCBcblxuZnVuY3Rpb24gZm9ybWF0KGYsIGFyZ3MsIG9wdHMpIHtcbiAgdmFyIHNzID0gKG9wdHMgJiYgb3B0cy5zdHJpbmdpZnkpIHx8IHRyeVN0cmluZ2lmeVxuICB2YXIgb2Zmc2V0ID0gMVxuICBpZiAoZiA9PT0gbnVsbCkge1xuICAgIGYgPSBhcmdzWzBdXG4gICAgb2Zmc2V0ID0gMFxuICB9XG4gIGlmICh0eXBlb2YgZiA9PT0gJ29iamVjdCcgJiYgZiAhPT0gbnVsbCkge1xuICAgIHZhciBsZW4gPSBhcmdzLmxlbmd0aCArIG9mZnNldFxuICAgIGlmIChsZW4gPT09IDEpIHJldHVybiBmXG4gICAgdmFyIG9iamVjdHMgPSBuZXcgQXJyYXkobGVuKVxuICAgIG9iamVjdHNbMF0gPSBzcyhmKVxuICAgIGZvciAodmFyIGluZGV4ID0gMTsgaW5kZXggPCBsZW47IGluZGV4KyspIHtcbiAgICAgIG9iamVjdHNbaW5kZXhdID0gc3MoYXJnc1tpbmRleF0pXG4gICAgfVxuICAgIHJldHVybiBvYmplY3RzLmpvaW4oJyAnKVxuICB9XG4gIHZhciBhcmdMZW4gPSBhcmdzLmxlbmd0aFxuICBpZiAoYXJnTGVuID09PSAwKSByZXR1cm4gZlxuICB2YXIgeCA9ICcnXG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgYSA9IDEgLSBvZmZzZXRcbiAgdmFyIGxhc3RQb3MgPSAwXG4gIHZhciBmbGVuID0gKGYgJiYgZi5sZW5ndGgpIHx8IDBcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBmbGVuOykge1xuICAgIGlmIChmLmNoYXJDb2RlQXQoaSkgPT09IDM3ICYmIGkgKyAxIDwgZmxlbikge1xuICAgICAgc3dpdGNoIChmLmNoYXJDb2RlQXQoaSArIDEpKSB7XG4gICAgICAgIGNhc2UgMTAwOiAvLyAnZCdcbiAgICAgICAgICBpZiAoYSA+PSBhcmdMZW4pXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGlmIChsYXN0UG9zIDwgaSlcbiAgICAgICAgICAgIHN0ciArPSBmLnNsaWNlKGxhc3RQb3MsIGkpXG4gICAgICAgICAgaWYgKGFyZ3NbYV0gPT0gbnVsbCkgIGJyZWFrXG4gICAgICAgICAgc3RyICs9IE51bWJlcihhcmdzW2FdKVxuICAgICAgICAgIGxhc3RQb3MgPSBpID0gaSArIDJcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDc5OiAvLyAnTydcbiAgICAgICAgY2FzZSAxMTE6IC8vICdvJ1xuICAgICAgICBjYXNlIDEwNjogLy8gJ2onXG4gICAgICAgICAgaWYgKGEgPj0gYXJnTGVuKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBpZiAobGFzdFBvcyA8IGkpXG4gICAgICAgICAgICBzdHIgKz0gZi5zbGljZShsYXN0UG9zLCBpKVxuICAgICAgICAgIGlmIChhcmdzW2FdID09PSB1bmRlZmluZWQpIGJyZWFrXG4gICAgICAgICAgdmFyIHR5cGUgPSB0eXBlb2YgYXJnc1thXVxuICAgICAgICAgIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgc3RyICs9ICdcXCcnICsgYXJnc1thXSArICdcXCcnXG4gICAgICAgICAgICBsYXN0UG9zID0gaSArIDJcbiAgICAgICAgICAgIGkrK1xuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHR5cGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHN0ciArPSBhcmdzW2FdLm5hbWUgfHwgJzxhbm9ueW1vdXM+J1xuICAgICAgICAgICAgbGFzdFBvcyA9IGkgKyAyXG4gICAgICAgICAgICBpKytcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgfVxuICAgICAgICAgIHN0ciArPSBzcyhhcmdzW2FdKVxuICAgICAgICAgIGxhc3RQb3MgPSBpICsgMlxuICAgICAgICAgIGkrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMTE1OiAvLyAncydcbiAgICAgICAgICBpZiAoYSA+PSBhcmdMZW4pXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGlmIChsYXN0UG9zIDwgaSlcbiAgICAgICAgICAgIHN0ciArPSBmLnNsaWNlKGxhc3RQb3MsIGkpXG4gICAgICAgICAgc3RyICs9IFN0cmluZyhhcmdzW2FdKVxuICAgICAgICAgIGxhc3RQb3MgPSBpICsgMlxuICAgICAgICAgIGkrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMzc6IC8vICclJ1xuICAgICAgICAgIGlmIChsYXN0UG9zIDwgaSlcbiAgICAgICAgICAgIHN0ciArPSBmLnNsaWNlKGxhc3RQb3MsIGkpXG4gICAgICAgICAgc3RyICs9ICclJ1xuICAgICAgICAgIGxhc3RQb3MgPSBpICsgMlxuICAgICAgICAgIGkrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICArK2FcbiAgICB9XG4gICAgKytpXG4gIH1cbiAgaWYgKGxhc3RQb3MgPT09IDApXG4gICAgc3RyID0gZlxuICBlbHNlIGlmIChsYXN0UG9zIDwgZmxlbikge1xuICAgIHN0ciArPSBmLnNsaWNlKGxhc3RQb3MpXG4gIH1cbiAgd2hpbGUgKGEgPCBhcmdMZW4pIHtcbiAgICB4ID0gYXJnc1thKytdXG4gICAgaWYgKHggPT09IG51bGwgfHwgKHR5cGVvZiB4ICE9PSAnb2JqZWN0JykpIHtcbiAgICAgIHN0ciArPSAnICcgKyBTdHJpbmcoeClcbiAgICB9IGVsc2Uge1xuICAgICAgc3RyICs9ICcgJyArIHNzKHgpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHN0clxufVxuIiwiJ3VzZSBzdHJpY3QnO1xuY29uc3QgZXNjYXBlU3RyaW5nUmVnZXhwID0gcmVxdWlyZSgnZXNjYXBlLXN0cmluZy1yZWdleHAnKTtcbmNvbnN0IGFuc2lTdHlsZXMgPSByZXF1aXJlKCdhbnNpLXN0eWxlcycpO1xuY29uc3Qgc3Rkb3V0Q29sb3IgPSByZXF1aXJlKCdzdXBwb3J0cy1jb2xvcicpLnN0ZG91dDtcblxuY29uc3QgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlcy5qcycpO1xuXG5jb25zdCBpc1NpbXBsZVdpbmRvd3NUZXJtID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyAmJiAhKHByb2Nlc3MuZW52LlRFUk0gfHwgJycpLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgneHRlcm0nKTtcblxuLy8gYHN1cHBvcnRzQ29sb3IubGV2ZWxgIOKGkiBgYW5zaVN0eWxlcy5jb2xvcltuYW1lXWAgbWFwcGluZ1xuY29uc3QgbGV2ZWxNYXBwaW5nID0gWydhbnNpJywgJ2Fuc2knLCAnYW5zaTI1NicsICdhbnNpMTZtJ107XG5cbi8vIGBjb2xvci1jb252ZXJ0YCBtb2RlbHMgdG8gZXhjbHVkZSBmcm9tIHRoZSBDaGFsayBBUEkgZHVlIHRvIGNvbmZsaWN0cyBhbmQgc3VjaFxuY29uc3Qgc2tpcE1vZGVscyA9IG5ldyBTZXQoWydncmF5J10pO1xuXG5jb25zdCBzdHlsZXMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG5mdW5jdGlvbiBhcHBseU9wdGlvbnMob2JqLCBvcHRpb25zKSB7XG5cdG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG5cdC8vIERldGVjdCBsZXZlbCBpZiBub3Qgc2V0IG1hbnVhbGx5XG5cdGNvbnN0IHNjTGV2ZWwgPSBzdGRvdXRDb2xvciA/IHN0ZG91dENvbG9yLmxldmVsIDogMDtcblx0b2JqLmxldmVsID0gb3B0aW9ucy5sZXZlbCA9PT0gdW5kZWZpbmVkID8gc2NMZXZlbCA6IG9wdGlvbnMubGV2ZWw7XG5cdG9iai5lbmFibGVkID0gJ2VuYWJsZWQnIGluIG9wdGlvbnMgPyBvcHRpb25zLmVuYWJsZWQgOiBvYmoubGV2ZWwgPiAwO1xufVxuXG5mdW5jdGlvbiBDaGFsayhvcHRpb25zKSB7XG5cdC8vIFdlIGNoZWNrIGZvciB0aGlzLnRlbXBsYXRlIGhlcmUgc2luY2UgY2FsbGluZyBgY2hhbGsuY29uc3RydWN0b3IoKWBcblx0Ly8gYnkgaXRzZWxmIHdpbGwgaGF2ZSBhIGB0aGlzYCBvZiBhIHByZXZpb3VzbHkgY29uc3RydWN0ZWQgY2hhbGsgb2JqZWN0XG5cdGlmICghdGhpcyB8fCAhKHRoaXMgaW5zdGFuY2VvZiBDaGFsaykgfHwgdGhpcy50ZW1wbGF0ZSkge1xuXHRcdGNvbnN0IGNoYWxrID0ge307XG5cdFx0YXBwbHlPcHRpb25zKGNoYWxrLCBvcHRpb25zKTtcblxuXHRcdGNoYWxrLnRlbXBsYXRlID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0Y29uc3QgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcblx0XHRcdHJldHVybiBjaGFsa1RhZy5hcHBseShudWxsLCBbY2hhbGsudGVtcGxhdGVdLmNvbmNhdChhcmdzKSk7XG5cdFx0fTtcblxuXHRcdE9iamVjdC5zZXRQcm90b3R5cGVPZihjaGFsaywgQ2hhbGsucHJvdG90eXBlKTtcblx0XHRPYmplY3Quc2V0UHJvdG90eXBlT2YoY2hhbGsudGVtcGxhdGUsIGNoYWxrKTtcblxuXHRcdGNoYWxrLnRlbXBsYXRlLmNvbnN0cnVjdG9yID0gQ2hhbGs7XG5cblx0XHRyZXR1cm4gY2hhbGsudGVtcGxhdGU7XG5cdH1cblxuXHRhcHBseU9wdGlvbnModGhpcywgb3B0aW9ucyk7XG59XG5cbi8vIFVzZSBicmlnaHQgYmx1ZSBvbiBXaW5kb3dzIGFzIHRoZSBub3JtYWwgYmx1ZSBjb2xvciBpcyBpbGxlZ2libGVcbmlmIChpc1NpbXBsZVdpbmRvd3NUZXJtKSB7XG5cdGFuc2lTdHlsZXMuYmx1ZS5vcGVuID0gJ1xcdTAwMUJbOTRtJztcbn1cblxuZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYW5zaVN0eWxlcykpIHtcblx0YW5zaVN0eWxlc1trZXldLmNsb3NlUmUgPSBuZXcgUmVnRXhwKGVzY2FwZVN0cmluZ1JlZ2V4cChhbnNpU3R5bGVzW2tleV0uY2xvc2UpLCAnZycpO1xuXG5cdHN0eWxlc1trZXldID0ge1xuXHRcdGdldCgpIHtcblx0XHRcdGNvbnN0IGNvZGVzID0gYW5zaVN0eWxlc1trZXldO1xuXHRcdFx0cmV0dXJuIGJ1aWxkLmNhbGwodGhpcywgdGhpcy5fc3R5bGVzID8gdGhpcy5fc3R5bGVzLmNvbmNhdChjb2RlcykgOiBbY29kZXNdLCB0aGlzLl9lbXB0eSwga2V5KTtcblx0XHR9XG5cdH07XG59XG5cbnN0eWxlcy52aXNpYmxlID0ge1xuXHRnZXQoKSB7XG5cdFx0cmV0dXJuIGJ1aWxkLmNhbGwodGhpcywgdGhpcy5fc3R5bGVzIHx8IFtdLCB0cnVlLCAndmlzaWJsZScpO1xuXHR9XG59O1xuXG5hbnNpU3R5bGVzLmNvbG9yLmNsb3NlUmUgPSBuZXcgUmVnRXhwKGVzY2FwZVN0cmluZ1JlZ2V4cChhbnNpU3R5bGVzLmNvbG9yLmNsb3NlKSwgJ2cnKTtcbmZvciAoY29uc3QgbW9kZWwgb2YgT2JqZWN0LmtleXMoYW5zaVN0eWxlcy5jb2xvci5hbnNpKSkge1xuXHRpZiAoc2tpcE1vZGVscy5oYXMobW9kZWwpKSB7XG5cdFx0Y29udGludWU7XG5cdH1cblxuXHRzdHlsZXNbbW9kZWxdID0ge1xuXHRcdGdldCgpIHtcblx0XHRcdGNvbnN0IGxldmVsID0gdGhpcy5sZXZlbDtcblx0XHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XG5cdFx0XHRcdGNvbnN0IG9wZW4gPSBhbnNpU3R5bGVzLmNvbG9yW2xldmVsTWFwcGluZ1tsZXZlbF1dW21vZGVsXS5hcHBseShudWxsLCBhcmd1bWVudHMpO1xuXHRcdFx0XHRjb25zdCBjb2RlcyA9IHtcblx0XHRcdFx0XHRvcGVuLFxuXHRcdFx0XHRcdGNsb3NlOiBhbnNpU3R5bGVzLmNvbG9yLmNsb3NlLFxuXHRcdFx0XHRcdGNsb3NlUmU6IGFuc2lTdHlsZXMuY29sb3IuY2xvc2VSZVxuXHRcdFx0XHR9O1xuXHRcdFx0XHRyZXR1cm4gYnVpbGQuY2FsbCh0aGlzLCB0aGlzLl9zdHlsZXMgPyB0aGlzLl9zdHlsZXMuY29uY2F0KGNvZGVzKSA6IFtjb2Rlc10sIHRoaXMuX2VtcHR5LCBtb2RlbCk7XG5cdFx0XHR9O1xuXHRcdH1cblx0fTtcbn1cblxuYW5zaVN0eWxlcy5iZ0NvbG9yLmNsb3NlUmUgPSBuZXcgUmVnRXhwKGVzY2FwZVN0cmluZ1JlZ2V4cChhbnNpU3R5bGVzLmJnQ29sb3IuY2xvc2UpLCAnZycpO1xuZm9yIChjb25zdCBtb2RlbCBvZiBPYmplY3Qua2V5cyhhbnNpU3R5bGVzLmJnQ29sb3IuYW5zaSkpIHtcblx0aWYgKHNraXBNb2RlbHMuaGFzKG1vZGVsKSkge1xuXHRcdGNvbnRpbnVlO1xuXHR9XG5cblx0Y29uc3QgYmdNb2RlbCA9ICdiZycgKyBtb2RlbFswXS50b1VwcGVyQ2FzZSgpICsgbW9kZWwuc2xpY2UoMSk7XG5cdHN0eWxlc1tiZ01vZGVsXSA9IHtcblx0XHRnZXQoKSB7XG5cdFx0XHRjb25zdCBsZXZlbCA9IHRoaXMubGV2ZWw7XG5cdFx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xuXHRcdFx0XHRjb25zdCBvcGVuID0gYW5zaVN0eWxlcy5iZ0NvbG9yW2xldmVsTWFwcGluZ1tsZXZlbF1dW21vZGVsXS5hcHBseShudWxsLCBhcmd1bWVudHMpO1xuXHRcdFx0XHRjb25zdCBjb2RlcyA9IHtcblx0XHRcdFx0XHRvcGVuLFxuXHRcdFx0XHRcdGNsb3NlOiBhbnNpU3R5bGVzLmJnQ29sb3IuY2xvc2UsXG5cdFx0XHRcdFx0Y2xvc2VSZTogYW5zaVN0eWxlcy5iZ0NvbG9yLmNsb3NlUmVcblx0XHRcdFx0fTtcblx0XHRcdFx0cmV0dXJuIGJ1aWxkLmNhbGwodGhpcywgdGhpcy5fc3R5bGVzID8gdGhpcy5fc3R5bGVzLmNvbmNhdChjb2RlcykgOiBbY29kZXNdLCB0aGlzLl9lbXB0eSwgbW9kZWwpO1xuXHRcdFx0fTtcblx0XHR9XG5cdH07XG59XG5cbmNvbnN0IHByb3RvID0gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoKCkgPT4ge30sIHN0eWxlcyk7XG5cbmZ1bmN0aW9uIGJ1aWxkKF9zdHlsZXMsIF9lbXB0eSwga2V5KSB7XG5cdGNvbnN0IGJ1aWxkZXIgPSBmdW5jdGlvbiAoKSB7XG5cdFx0cmV0dXJuIGFwcGx5U3R5bGUuYXBwbHkoYnVpbGRlciwgYXJndW1lbnRzKTtcblx0fTtcblxuXHRidWlsZGVyLl9zdHlsZXMgPSBfc3R5bGVzO1xuXHRidWlsZGVyLl9lbXB0eSA9IF9lbXB0eTtcblxuXHRjb25zdCBzZWxmID0gdGhpcztcblxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoYnVpbGRlciwgJ2xldmVsJywge1xuXHRcdGVudW1lcmFibGU6IHRydWUsXG5cdFx0Z2V0KCkge1xuXHRcdFx0cmV0dXJuIHNlbGYubGV2ZWw7XG5cdFx0fSxcblx0XHRzZXQobGV2ZWwpIHtcblx0XHRcdHNlbGYubGV2ZWwgPSBsZXZlbDtcblx0XHR9XG5cdH0pO1xuXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShidWlsZGVyLCAnZW5hYmxlZCcsIHtcblx0XHRlbnVtZXJhYmxlOiB0cnVlLFxuXHRcdGdldCgpIHtcblx0XHRcdHJldHVybiBzZWxmLmVuYWJsZWQ7XG5cdFx0fSxcblx0XHRzZXQoZW5hYmxlZCkge1xuXHRcdFx0c2VsZi5lbmFibGVkID0gZW5hYmxlZDtcblx0XHR9XG5cdH0pO1xuXG5cdC8vIFNlZSBiZWxvdyBmb3IgZml4IHJlZ2FyZGluZyBpbnZpc2libGUgZ3JleS9kaW0gY29tYmluYXRpb24gb24gV2luZG93c1xuXHRidWlsZGVyLmhhc0dyZXkgPSB0aGlzLmhhc0dyZXkgfHwga2V5ID09PSAnZ3JheScgfHwga2V5ID09PSAnZ3JleSc7XG5cblx0Ly8gYF9fcHJvdG9fX2AgaXMgdXNlZCBiZWNhdXNlIHdlIG11c3QgcmV0dXJuIGEgZnVuY3Rpb24sIGJ1dCB0aGVyZSBpc1xuXHQvLyBubyB3YXkgdG8gY3JlYXRlIGEgZnVuY3Rpb24gd2l0aCBhIGRpZmZlcmVudCBwcm90b3R5cGVcblx0YnVpbGRlci5fX3Byb3RvX18gPSBwcm90bzsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b1xuXG5cdHJldHVybiBidWlsZGVyO1xufVxuXG5mdW5jdGlvbiBhcHBseVN0eWxlKCkge1xuXHQvLyBTdXBwb3J0IHZhcmFncywgYnV0IHNpbXBseSBjYXN0IHRvIHN0cmluZyBpbiBjYXNlIHRoZXJlJ3Mgb25seSBvbmUgYXJnXG5cdGNvbnN0IGFyZ3MgPSBhcmd1bWVudHM7XG5cdGNvbnN0IGFyZ3NMZW4gPSBhcmdzLmxlbmd0aDtcblx0bGV0IHN0ciA9IFN0cmluZyhhcmd1bWVudHNbMF0pO1xuXG5cdGlmIChhcmdzTGVuID09PSAwKSB7XG5cdFx0cmV0dXJuICcnO1xuXHR9XG5cblx0aWYgKGFyZ3NMZW4gPiAxKSB7XG5cdFx0Ly8gRG9uJ3Qgc2xpY2UgYGFyZ3VtZW50c2AsIGl0IHByZXZlbnRzIFY4IG9wdGltaXphdGlvbnNcblx0XHRmb3IgKGxldCBhID0gMTsgYSA8IGFyZ3NMZW47IGErKykge1xuXHRcdFx0c3RyICs9ICcgJyArIGFyZ3NbYV07XG5cdFx0fVxuXHR9XG5cblx0aWYgKCF0aGlzLmVuYWJsZWQgfHwgdGhpcy5sZXZlbCA8PSAwIHx8ICFzdHIpIHtcblx0XHRyZXR1cm4gdGhpcy5fZW1wdHkgPyAnJyA6IHN0cjtcblx0fVxuXG5cdC8vIFR1cm5zIG91dCB0aGF0IG9uIFdpbmRvd3MgZGltbWVkIGdyYXkgdGV4dCBiZWNvbWVzIGludmlzaWJsZSBpbiBjbWQuZXhlLFxuXHQvLyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL2NoYWxrL2NoYWxrL2lzc3Vlcy81OFxuXHQvLyBJZiB3ZSdyZSBvbiBXaW5kb3dzIGFuZCB3ZSdyZSBkZWFsaW5nIHdpdGggYSBncmF5IGNvbG9yLCB0ZW1wb3JhcmlseSBtYWtlICdkaW0nIGEgbm9vcC5cblx0Y29uc3Qgb3JpZ2luYWxEaW0gPSBhbnNpU3R5bGVzLmRpbS5vcGVuO1xuXHRpZiAoaXNTaW1wbGVXaW5kb3dzVGVybSAmJiB0aGlzLmhhc0dyZXkpIHtcblx0XHRhbnNpU3R5bGVzLmRpbS5vcGVuID0gJyc7XG5cdH1cblxuXHRmb3IgKGNvbnN0IGNvZGUgb2YgdGhpcy5fc3R5bGVzLnNsaWNlKCkucmV2ZXJzZSgpKSB7XG5cdFx0Ly8gUmVwbGFjZSBhbnkgaW5zdGFuY2VzIGFscmVhZHkgcHJlc2VudCB3aXRoIGEgcmUtb3BlbmluZyBjb2RlXG5cdFx0Ly8gb3RoZXJ3aXNlIG9ubHkgdGhlIHBhcnQgb2YgdGhlIHN0cmluZyB1bnRpbCBzYWlkIGNsb3NpbmcgY29kZVxuXHRcdC8vIHdpbGwgYmUgY29sb3JlZCwgYW5kIHRoZSByZXN0IHdpbGwgc2ltcGx5IGJlICdwbGFpbicuXG5cdFx0c3RyID0gY29kZS5vcGVuICsgc3RyLnJlcGxhY2UoY29kZS5jbG9zZVJlLCBjb2RlLm9wZW4pICsgY29kZS5jbG9zZTtcblxuXHRcdC8vIENsb3NlIHRoZSBzdHlsaW5nIGJlZm9yZSBhIGxpbmVicmVhayBhbmQgcmVvcGVuXG5cdFx0Ly8gYWZ0ZXIgbmV4dCBsaW5lIHRvIGZpeCBhIGJsZWVkIGlzc3VlIG9uIG1hY09TXG5cdFx0Ly8gaHR0cHM6Ly9naXRodWIuY29tL2NoYWxrL2NoYWxrL3B1bGwvOTJcblx0XHRzdHIgPSBzdHIucmVwbGFjZSgvXFxyP1xcbi9nLCBgJHtjb2RlLmNsb3NlfSQmJHtjb2RlLm9wZW59YCk7XG5cdH1cblxuXHQvLyBSZXNldCB0aGUgb3JpZ2luYWwgYGRpbWAgaWYgd2UgY2hhbmdlZCBpdCB0byB3b3JrIGFyb3VuZCB0aGUgV2luZG93cyBkaW1tZWQgZ3JheSBpc3N1ZVxuXHRhbnNpU3R5bGVzLmRpbS5vcGVuID0gb3JpZ2luYWxEaW07XG5cblx0cmV0dXJuIHN0cjtcbn1cblxuZnVuY3Rpb24gY2hhbGtUYWcoY2hhbGssIHN0cmluZ3MpIHtcblx0aWYgKCFBcnJheS5pc0FycmF5KHN0cmluZ3MpKSB7XG5cdFx0Ly8gSWYgY2hhbGsoKSB3YXMgY2FsbGVkIGJ5IGl0c2VsZiBvciB3aXRoIGEgc3RyaW5nLFxuXHRcdC8vIHJldHVybiB0aGUgc3RyaW5nIGl0c2VsZiBhcyBhIHN0cmluZy5cblx0XHRyZXR1cm4gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLmpvaW4oJyAnKTtcblx0fVxuXG5cdGNvbnN0IGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG5cdGNvbnN0IHBhcnRzID0gW3N0cmluZ3MucmF3WzBdXTtcblxuXHRmb3IgKGxldCBpID0gMTsgaSA8IHN0cmluZ3MubGVuZ3RoOyBpKyspIHtcblx0XHRwYXJ0cy5wdXNoKFN0cmluZyhhcmdzW2kgLSAxXSkucmVwbGFjZSgvW3t9XFxcXF0vZywgJ1xcXFwkJicpKTtcblx0XHRwYXJ0cy5wdXNoKFN0cmluZyhzdHJpbmdzLnJhd1tpXSkpO1xuXHR9XG5cblx0cmV0dXJuIHRlbXBsYXRlKGNoYWxrLCBwYXJ0cy5qb2luKCcnKSk7XG59XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKENoYWxrLnByb3RvdHlwZSwgc3R5bGVzKTtcblxubW9kdWxlLmV4cG9ydHMgPSBDaGFsaygpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5ldy1jYXBcbm1vZHVsZS5leHBvcnRzLnN1cHBvcnRzQ29sb3IgPSBzdGRvdXRDb2xvcjtcbm1vZHVsZS5leHBvcnRzLmRlZmF1bHQgPSBtb2R1bGUuZXhwb3J0czsgLy8gRm9yIFR5cGVTY3JpcHRcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1hdGNoT3BlcmF0b3JzUmUgPSAvW3xcXFxce30oKVtcXF1eJCsqPy5dL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHN0cikge1xuXHRpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdFeHBlY3RlZCBhIHN0cmluZycpO1xuXHR9XG5cblx0cmV0dXJuIHN0ci5yZXBsYWNlKG1hdGNoT3BlcmF0b3JzUmUsICdcXFxcJCYnKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5jb25zdCBjb2xvckNvbnZlcnQgPSByZXF1aXJlKCdjb2xvci1jb252ZXJ0Jyk7XG5cbmNvbnN0IHdyYXBBbnNpMTYgPSAoZm4sIG9mZnNldCkgPT4gZnVuY3Rpb24gKCkge1xuXHRjb25zdCBjb2RlID0gZm4uYXBwbHkoY29sb3JDb252ZXJ0LCBhcmd1bWVudHMpO1xuXHRyZXR1cm4gYFxcdTAwMUJbJHtjb2RlICsgb2Zmc2V0fW1gO1xufTtcblxuY29uc3Qgd3JhcEFuc2kyNTYgPSAoZm4sIG9mZnNldCkgPT4gZnVuY3Rpb24gKCkge1xuXHRjb25zdCBjb2RlID0gZm4uYXBwbHkoY29sb3JDb252ZXJ0LCBhcmd1bWVudHMpO1xuXHRyZXR1cm4gYFxcdTAwMUJbJHszOCArIG9mZnNldH07NTske2NvZGV9bWA7XG59O1xuXG5jb25zdCB3cmFwQW5zaTE2bSA9IChmbiwgb2Zmc2V0KSA9PiBmdW5jdGlvbiAoKSB7XG5cdGNvbnN0IHJnYiA9IGZuLmFwcGx5KGNvbG9yQ29udmVydCwgYXJndW1lbnRzKTtcblx0cmV0dXJuIGBcXHUwMDFCWyR7MzggKyBvZmZzZXR9OzI7JHtyZ2JbMF19OyR7cmdiWzFdfTske3JnYlsyXX1tYDtcbn07XG5cbmZ1bmN0aW9uIGFzc2VtYmxlU3R5bGVzKCkge1xuXHRjb25zdCBjb2RlcyA9IG5ldyBNYXAoKTtcblx0Y29uc3Qgc3R5bGVzID0ge1xuXHRcdG1vZGlmaWVyOiB7XG5cdFx0XHRyZXNldDogWzAsIDBdLFxuXHRcdFx0Ly8gMjEgaXNuJ3Qgd2lkZWx5IHN1cHBvcnRlZCBhbmQgMjIgZG9lcyB0aGUgc2FtZSB0aGluZ1xuXHRcdFx0Ym9sZDogWzEsIDIyXSxcblx0XHRcdGRpbTogWzIsIDIyXSxcblx0XHRcdGl0YWxpYzogWzMsIDIzXSxcblx0XHRcdHVuZGVybGluZTogWzQsIDI0XSxcblx0XHRcdGludmVyc2U6IFs3LCAyN10sXG5cdFx0XHRoaWRkZW46IFs4LCAyOF0sXG5cdFx0XHRzdHJpa2V0aHJvdWdoOiBbOSwgMjldXG5cdFx0fSxcblx0XHRjb2xvcjoge1xuXHRcdFx0YmxhY2s6IFszMCwgMzldLFxuXHRcdFx0cmVkOiBbMzEsIDM5XSxcblx0XHRcdGdyZWVuOiBbMzIsIDM5XSxcblx0XHRcdHllbGxvdzogWzMzLCAzOV0sXG5cdFx0XHRibHVlOiBbMzQsIDM5XSxcblx0XHRcdG1hZ2VudGE6IFszNSwgMzldLFxuXHRcdFx0Y3lhbjogWzM2LCAzOV0sXG5cdFx0XHR3aGl0ZTogWzM3LCAzOV0sXG5cdFx0XHRncmF5OiBbOTAsIDM5XSxcblxuXHRcdFx0Ly8gQnJpZ2h0IGNvbG9yXG5cdFx0XHRyZWRCcmlnaHQ6IFs5MSwgMzldLFxuXHRcdFx0Z3JlZW5CcmlnaHQ6IFs5MiwgMzldLFxuXHRcdFx0eWVsbG93QnJpZ2h0OiBbOTMsIDM5XSxcblx0XHRcdGJsdWVCcmlnaHQ6IFs5NCwgMzldLFxuXHRcdFx0bWFnZW50YUJyaWdodDogWzk1LCAzOV0sXG5cdFx0XHRjeWFuQnJpZ2h0OiBbOTYsIDM5XSxcblx0XHRcdHdoaXRlQnJpZ2h0OiBbOTcsIDM5XVxuXHRcdH0sXG5cdFx0YmdDb2xvcjoge1xuXHRcdFx0YmdCbGFjazogWzQwLCA0OV0sXG5cdFx0XHRiZ1JlZDogWzQxLCA0OV0sXG5cdFx0XHRiZ0dyZWVuOiBbNDIsIDQ5XSxcblx0XHRcdGJnWWVsbG93OiBbNDMsIDQ5XSxcblx0XHRcdGJnQmx1ZTogWzQ0LCA0OV0sXG5cdFx0XHRiZ01hZ2VudGE6IFs0NSwgNDldLFxuXHRcdFx0YmdDeWFuOiBbNDYsIDQ5XSxcblx0XHRcdGJnV2hpdGU6IFs0NywgNDldLFxuXG5cdFx0XHQvLyBCcmlnaHQgY29sb3Jcblx0XHRcdGJnQmxhY2tCcmlnaHQ6IFsxMDAsIDQ5XSxcblx0XHRcdGJnUmVkQnJpZ2h0OiBbMTAxLCA0OV0sXG5cdFx0XHRiZ0dyZWVuQnJpZ2h0OiBbMTAyLCA0OV0sXG5cdFx0XHRiZ1llbGxvd0JyaWdodDogWzEwMywgNDldLFxuXHRcdFx0YmdCbHVlQnJpZ2h0OiBbMTA0LCA0OV0sXG5cdFx0XHRiZ01hZ2VudGFCcmlnaHQ6IFsxMDUsIDQ5XSxcblx0XHRcdGJnQ3lhbkJyaWdodDogWzEwNiwgNDldLFxuXHRcdFx0YmdXaGl0ZUJyaWdodDogWzEwNywgNDldXG5cdFx0fVxuXHR9O1xuXG5cdC8vIEZpeCBodW1hbnNcblx0c3R5bGVzLmNvbG9yLmdyZXkgPSBzdHlsZXMuY29sb3IuZ3JheTtcblxuXHRmb3IgKGNvbnN0IGdyb3VwTmFtZSBvZiBPYmplY3Qua2V5cyhzdHlsZXMpKSB7XG5cdFx0Y29uc3QgZ3JvdXAgPSBzdHlsZXNbZ3JvdXBOYW1lXTtcblxuXHRcdGZvciAoY29uc3Qgc3R5bGVOYW1lIG9mIE9iamVjdC5rZXlzKGdyb3VwKSkge1xuXHRcdFx0Y29uc3Qgc3R5bGUgPSBncm91cFtzdHlsZU5hbWVdO1xuXG5cdFx0XHRzdHlsZXNbc3R5bGVOYW1lXSA9IHtcblx0XHRcdFx0b3BlbjogYFxcdTAwMUJbJHtzdHlsZVswXX1tYCxcblx0XHRcdFx0Y2xvc2U6IGBcXHUwMDFCWyR7c3R5bGVbMV19bWBcblx0XHRcdH07XG5cblx0XHRcdGdyb3VwW3N0eWxlTmFtZV0gPSBzdHlsZXNbc3R5bGVOYW1lXTtcblxuXHRcdFx0Y29kZXMuc2V0KHN0eWxlWzBdLCBzdHlsZVsxXSk7XG5cdFx0fVxuXG5cdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHN0eWxlcywgZ3JvdXBOYW1lLCB7XG5cdFx0XHR2YWx1ZTogZ3JvdXAsXG5cdFx0XHRlbnVtZXJhYmxlOiBmYWxzZVxuXHRcdH0pO1xuXG5cdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHN0eWxlcywgJ2NvZGVzJywge1xuXHRcdFx0dmFsdWU6IGNvZGVzLFxuXHRcdFx0ZW51bWVyYWJsZTogZmFsc2Vcblx0XHR9KTtcblx0fVxuXG5cdGNvbnN0IGFuc2kyYW5zaSA9IG4gPT4gbjtcblx0Y29uc3QgcmdiMnJnYiA9IChyLCBnLCBiKSA9PiBbciwgZywgYl07XG5cblx0c3R5bGVzLmNvbG9yLmNsb3NlID0gJ1xcdTAwMUJbMzltJztcblx0c3R5bGVzLmJnQ29sb3IuY2xvc2UgPSAnXFx1MDAxQls0OW0nO1xuXG5cdHN0eWxlcy5jb2xvci5hbnNpID0ge1xuXHRcdGFuc2k6IHdyYXBBbnNpMTYoYW5zaTJhbnNpLCAwKVxuXHR9O1xuXHRzdHlsZXMuY29sb3IuYW5zaTI1NiA9IHtcblx0XHRhbnNpMjU2OiB3cmFwQW5zaTI1NihhbnNpMmFuc2ksIDApXG5cdH07XG5cdHN0eWxlcy5jb2xvci5hbnNpMTZtID0ge1xuXHRcdHJnYjogd3JhcEFuc2kxNm0ocmdiMnJnYiwgMClcblx0fTtcblxuXHRzdHlsZXMuYmdDb2xvci5hbnNpID0ge1xuXHRcdGFuc2k6IHdyYXBBbnNpMTYoYW5zaTJhbnNpLCAxMClcblx0fTtcblx0c3R5bGVzLmJnQ29sb3IuYW5zaTI1NiA9IHtcblx0XHRhbnNpMjU2OiB3cmFwQW5zaTI1NihhbnNpMmFuc2ksIDEwKVxuXHR9O1xuXHRzdHlsZXMuYmdDb2xvci5hbnNpMTZtID0ge1xuXHRcdHJnYjogd3JhcEFuc2kxNm0ocmdiMnJnYiwgMTApXG5cdH07XG5cblx0Zm9yIChsZXQga2V5IG9mIE9iamVjdC5rZXlzKGNvbG9yQ29udmVydCkpIHtcblx0XHRpZiAodHlwZW9mIGNvbG9yQ29udmVydFtrZXldICE9PSAnb2JqZWN0Jykge1xuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXG5cdFx0Y29uc3Qgc3VpdGUgPSBjb2xvckNvbnZlcnRba2V5XTtcblxuXHRcdGlmIChrZXkgPT09ICdhbnNpMTYnKSB7XG5cdFx0XHRrZXkgPSAnYW5zaSc7XG5cdFx0fVxuXG5cdFx0aWYgKCdhbnNpMTYnIGluIHN1aXRlKSB7XG5cdFx0XHRzdHlsZXMuY29sb3IuYW5zaVtrZXldID0gd3JhcEFuc2kxNihzdWl0ZS5hbnNpMTYsIDApO1xuXHRcdFx0c3R5bGVzLmJnQ29sb3IuYW5zaVtrZXldID0gd3JhcEFuc2kxNihzdWl0ZS5hbnNpMTYsIDEwKTtcblx0XHR9XG5cblx0XHRpZiAoJ2Fuc2kyNTYnIGluIHN1aXRlKSB7XG5cdFx0XHRzdHlsZXMuY29sb3IuYW5zaTI1NltrZXldID0gd3JhcEFuc2kyNTYoc3VpdGUuYW5zaTI1NiwgMCk7XG5cdFx0XHRzdHlsZXMuYmdDb2xvci5hbnNpMjU2W2tleV0gPSB3cmFwQW5zaTI1NihzdWl0ZS5hbnNpMjU2LCAxMCk7XG5cdFx0fVxuXG5cdFx0aWYgKCdyZ2InIGluIHN1aXRlKSB7XG5cdFx0XHRzdHlsZXMuY29sb3IuYW5zaTE2bVtrZXldID0gd3JhcEFuc2kxNm0oc3VpdGUucmdiLCAwKTtcblx0XHRcdHN0eWxlcy5iZ0NvbG9yLmFuc2kxNm1ba2V5XSA9IHdyYXBBbnNpMTZtKHN1aXRlLnJnYiwgMTApO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiBzdHlsZXM7XG59XG5cbi8vIE1ha2UgdGhlIGV4cG9ydCBpbW11dGFibGVcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShtb2R1bGUsICdleHBvcnRzJywge1xuXHRlbnVtZXJhYmxlOiB0cnVlLFxuXHRnZXQ6IGFzc2VtYmxlU3R5bGVzXG59KTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24obW9kdWxlKSB7XG5cdGlmICghbW9kdWxlLndlYnBhY2tQb2x5ZmlsbCkge1xuXHRcdG1vZHVsZS5kZXByZWNhdGUgPSBmdW5jdGlvbigpIHt9O1xuXHRcdG1vZHVsZS5wYXRocyA9IFtdO1xuXHRcdC8vIG1vZHVsZS5wYXJlbnQgPSB1bmRlZmluZWQgYnkgZGVmYXVsdFxuXHRcdGlmICghbW9kdWxlLmNoaWxkcmVuKSBtb2R1bGUuY2hpbGRyZW4gPSBbXTtcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkobW9kdWxlLCBcImxvYWRlZFwiLCB7XG5cdFx0XHRlbnVtZXJhYmxlOiB0cnVlLFxuXHRcdFx0Z2V0OiBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIG1vZHVsZS5sO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShtb2R1bGUsIFwiaWRcIiwge1xuXHRcdFx0ZW51bWVyYWJsZTogdHJ1ZSxcblx0XHRcdGdldDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBtb2R1bGUuaTtcblx0XHRcdH1cblx0XHR9KTtcblx0XHRtb2R1bGUud2VicGFja1BvbHlmaWxsID0gMTtcblx0fVxuXHRyZXR1cm4gbW9kdWxlO1xufTtcbiIsInZhciBjb252ZXJzaW9ucyA9IHJlcXVpcmUoJy4vY29udmVyc2lvbnMnKTtcbnZhciByb3V0ZSA9IHJlcXVpcmUoJy4vcm91dGUnKTtcblxudmFyIGNvbnZlcnQgPSB7fTtcblxudmFyIG1vZGVscyA9IE9iamVjdC5rZXlzKGNvbnZlcnNpb25zKTtcblxuZnVuY3Rpb24gd3JhcFJhdyhmbikge1xuXHR2YXIgd3JhcHBlZEZuID0gZnVuY3Rpb24gKGFyZ3MpIHtcblx0XHRpZiAoYXJncyA9PT0gdW5kZWZpbmVkIHx8IGFyZ3MgPT09IG51bGwpIHtcblx0XHRcdHJldHVybiBhcmdzO1xuXHRcdH1cblxuXHRcdGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuXHRcdFx0YXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGZuKGFyZ3MpO1xuXHR9O1xuXG5cdC8vIHByZXNlcnZlIC5jb252ZXJzaW9uIHByb3BlcnR5IGlmIHRoZXJlIGlzIG9uZVxuXHRpZiAoJ2NvbnZlcnNpb24nIGluIGZuKSB7XG5cdFx0d3JhcHBlZEZuLmNvbnZlcnNpb24gPSBmbi5jb252ZXJzaW9uO1xuXHR9XG5cblx0cmV0dXJuIHdyYXBwZWRGbjtcbn1cblxuZnVuY3Rpb24gd3JhcFJvdW5kZWQoZm4pIHtcblx0dmFyIHdyYXBwZWRGbiA9IGZ1bmN0aW9uIChhcmdzKSB7XG5cdFx0aWYgKGFyZ3MgPT09IHVuZGVmaW5lZCB8fCBhcmdzID09PSBudWxsKSB7XG5cdFx0XHRyZXR1cm4gYXJncztcblx0XHR9XG5cblx0XHRpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcblx0XHRcdGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuXHRcdH1cblxuXHRcdHZhciByZXN1bHQgPSBmbihhcmdzKTtcblxuXHRcdC8vIHdlJ3JlIGFzc3VtaW5nIHRoZSByZXN1bHQgaXMgYW4gYXJyYXkgaGVyZS5cblx0XHQvLyBzZWUgbm90aWNlIGluIGNvbnZlcnNpb25zLmpzOyBkb24ndCB1c2UgYm94IHR5cGVzXG5cdFx0Ly8gaW4gY29udmVyc2lvbiBmdW5jdGlvbnMuXG5cdFx0aWYgKHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRmb3IgKHZhciBsZW4gPSByZXN1bHQubGVuZ3RoLCBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG5cdFx0XHRcdHJlc3VsdFtpXSA9IE1hdGgucm91bmQocmVzdWx0W2ldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9O1xuXG5cdC8vIHByZXNlcnZlIC5jb252ZXJzaW9uIHByb3BlcnR5IGlmIHRoZXJlIGlzIG9uZVxuXHRpZiAoJ2NvbnZlcnNpb24nIGluIGZuKSB7XG5cdFx0d3JhcHBlZEZuLmNvbnZlcnNpb24gPSBmbi5jb252ZXJzaW9uO1xuXHR9XG5cblx0cmV0dXJuIHdyYXBwZWRGbjtcbn1cblxubW9kZWxzLmZvckVhY2goZnVuY3Rpb24gKGZyb21Nb2RlbCkge1xuXHRjb252ZXJ0W2Zyb21Nb2RlbF0gPSB7fTtcblxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoY29udmVydFtmcm9tTW9kZWxdLCAnY2hhbm5lbHMnLCB7dmFsdWU6IGNvbnZlcnNpb25zW2Zyb21Nb2RlbF0uY2hhbm5lbHN9KTtcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGNvbnZlcnRbZnJvbU1vZGVsXSwgJ2xhYmVscycsIHt2YWx1ZTogY29udmVyc2lvbnNbZnJvbU1vZGVsXS5sYWJlbHN9KTtcblxuXHR2YXIgcm91dGVzID0gcm91dGUoZnJvbU1vZGVsKTtcblx0dmFyIHJvdXRlTW9kZWxzID0gT2JqZWN0LmtleXMocm91dGVzKTtcblxuXHRyb3V0ZU1vZGVscy5mb3JFYWNoKGZ1bmN0aW9uICh0b01vZGVsKSB7XG5cdFx0dmFyIGZuID0gcm91dGVzW3RvTW9kZWxdO1xuXG5cdFx0Y29udmVydFtmcm9tTW9kZWxdW3RvTW9kZWxdID0gd3JhcFJvdW5kZWQoZm4pO1xuXHRcdGNvbnZlcnRbZnJvbU1vZGVsXVt0b01vZGVsXS5yYXcgPSB3cmFwUmF3KGZuKTtcblx0fSk7XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBjb252ZXJ0O1xuIiwiJ3VzZSBzdHJpY3QnXHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuXHRcImFsaWNlYmx1ZVwiOiBbMjQwLCAyNDgsIDI1NV0sXHJcblx0XCJhbnRpcXVld2hpdGVcIjogWzI1MCwgMjM1LCAyMTVdLFxyXG5cdFwiYXF1YVwiOiBbMCwgMjU1LCAyNTVdLFxyXG5cdFwiYXF1YW1hcmluZVwiOiBbMTI3LCAyNTUsIDIxMl0sXHJcblx0XCJhenVyZVwiOiBbMjQwLCAyNTUsIDI1NV0sXHJcblx0XCJiZWlnZVwiOiBbMjQ1LCAyNDUsIDIyMF0sXHJcblx0XCJiaXNxdWVcIjogWzI1NSwgMjI4LCAxOTZdLFxyXG5cdFwiYmxhY2tcIjogWzAsIDAsIDBdLFxyXG5cdFwiYmxhbmNoZWRhbG1vbmRcIjogWzI1NSwgMjM1LCAyMDVdLFxyXG5cdFwiYmx1ZVwiOiBbMCwgMCwgMjU1XSxcclxuXHRcImJsdWV2aW9sZXRcIjogWzEzOCwgNDMsIDIyNl0sXHJcblx0XCJicm93blwiOiBbMTY1LCA0MiwgNDJdLFxyXG5cdFwiYnVybHl3b29kXCI6IFsyMjIsIDE4NCwgMTM1XSxcclxuXHRcImNhZGV0Ymx1ZVwiOiBbOTUsIDE1OCwgMTYwXSxcclxuXHRcImNoYXJ0cmV1c2VcIjogWzEyNywgMjU1LCAwXSxcclxuXHRcImNob2NvbGF0ZVwiOiBbMjEwLCAxMDUsIDMwXSxcclxuXHRcImNvcmFsXCI6IFsyNTUsIDEyNywgODBdLFxyXG5cdFwiY29ybmZsb3dlcmJsdWVcIjogWzEwMCwgMTQ5LCAyMzddLFxyXG5cdFwiY29ybnNpbGtcIjogWzI1NSwgMjQ4LCAyMjBdLFxyXG5cdFwiY3JpbXNvblwiOiBbMjIwLCAyMCwgNjBdLFxyXG5cdFwiY3lhblwiOiBbMCwgMjU1LCAyNTVdLFxyXG5cdFwiZGFya2JsdWVcIjogWzAsIDAsIDEzOV0sXHJcblx0XCJkYXJrY3lhblwiOiBbMCwgMTM5LCAxMzldLFxyXG5cdFwiZGFya2dvbGRlbnJvZFwiOiBbMTg0LCAxMzQsIDExXSxcclxuXHRcImRhcmtncmF5XCI6IFsxNjksIDE2OSwgMTY5XSxcclxuXHRcImRhcmtncmVlblwiOiBbMCwgMTAwLCAwXSxcclxuXHRcImRhcmtncmV5XCI6IFsxNjksIDE2OSwgMTY5XSxcclxuXHRcImRhcmtraGFraVwiOiBbMTg5LCAxODMsIDEwN10sXHJcblx0XCJkYXJrbWFnZW50YVwiOiBbMTM5LCAwLCAxMzldLFxyXG5cdFwiZGFya29saXZlZ3JlZW5cIjogWzg1LCAxMDcsIDQ3XSxcclxuXHRcImRhcmtvcmFuZ2VcIjogWzI1NSwgMTQwLCAwXSxcclxuXHRcImRhcmtvcmNoaWRcIjogWzE1MywgNTAsIDIwNF0sXHJcblx0XCJkYXJrcmVkXCI6IFsxMzksIDAsIDBdLFxyXG5cdFwiZGFya3NhbG1vblwiOiBbMjMzLCAxNTAsIDEyMl0sXHJcblx0XCJkYXJrc2VhZ3JlZW5cIjogWzE0MywgMTg4LCAxNDNdLFxyXG5cdFwiZGFya3NsYXRlYmx1ZVwiOiBbNzIsIDYxLCAxMzldLFxyXG5cdFwiZGFya3NsYXRlZ3JheVwiOiBbNDcsIDc5LCA3OV0sXHJcblx0XCJkYXJrc2xhdGVncmV5XCI6IFs0NywgNzksIDc5XSxcclxuXHRcImRhcmt0dXJxdW9pc2VcIjogWzAsIDIwNiwgMjA5XSxcclxuXHRcImRhcmt2aW9sZXRcIjogWzE0OCwgMCwgMjExXSxcclxuXHRcImRlZXBwaW5rXCI6IFsyNTUsIDIwLCAxNDddLFxyXG5cdFwiZGVlcHNreWJsdWVcIjogWzAsIDE5MSwgMjU1XSxcclxuXHRcImRpbWdyYXlcIjogWzEwNSwgMTA1LCAxMDVdLFxyXG5cdFwiZGltZ3JleVwiOiBbMTA1LCAxMDUsIDEwNV0sXHJcblx0XCJkb2RnZXJibHVlXCI6IFszMCwgMTQ0LCAyNTVdLFxyXG5cdFwiZmlyZWJyaWNrXCI6IFsxNzgsIDM0LCAzNF0sXHJcblx0XCJmbG9yYWx3aGl0ZVwiOiBbMjU1LCAyNTAsIDI0MF0sXHJcblx0XCJmb3Jlc3RncmVlblwiOiBbMzQsIDEzOSwgMzRdLFxyXG5cdFwiZnVjaHNpYVwiOiBbMjU1LCAwLCAyNTVdLFxyXG5cdFwiZ2FpbnNib3JvXCI6IFsyMjAsIDIyMCwgMjIwXSxcclxuXHRcImdob3N0d2hpdGVcIjogWzI0OCwgMjQ4LCAyNTVdLFxyXG5cdFwiZ29sZFwiOiBbMjU1LCAyMTUsIDBdLFxyXG5cdFwiZ29sZGVucm9kXCI6IFsyMTgsIDE2NSwgMzJdLFxyXG5cdFwiZ3JheVwiOiBbMTI4LCAxMjgsIDEyOF0sXHJcblx0XCJncmVlblwiOiBbMCwgMTI4LCAwXSxcclxuXHRcImdyZWVueWVsbG93XCI6IFsxNzMsIDI1NSwgNDddLFxyXG5cdFwiZ3JleVwiOiBbMTI4LCAxMjgsIDEyOF0sXHJcblx0XCJob25leWRld1wiOiBbMjQwLCAyNTUsIDI0MF0sXHJcblx0XCJob3RwaW5rXCI6IFsyNTUsIDEwNSwgMTgwXSxcclxuXHRcImluZGlhbnJlZFwiOiBbMjA1LCA5MiwgOTJdLFxyXG5cdFwiaW5kaWdvXCI6IFs3NSwgMCwgMTMwXSxcclxuXHRcIml2b3J5XCI6IFsyNTUsIDI1NSwgMjQwXSxcclxuXHRcImtoYWtpXCI6IFsyNDAsIDIzMCwgMTQwXSxcclxuXHRcImxhdmVuZGVyXCI6IFsyMzAsIDIzMCwgMjUwXSxcclxuXHRcImxhdmVuZGVyYmx1c2hcIjogWzI1NSwgMjQwLCAyNDVdLFxyXG5cdFwibGF3bmdyZWVuXCI6IFsxMjQsIDI1MiwgMF0sXHJcblx0XCJsZW1vbmNoaWZmb25cIjogWzI1NSwgMjUwLCAyMDVdLFxyXG5cdFwibGlnaHRibHVlXCI6IFsxNzMsIDIxNiwgMjMwXSxcclxuXHRcImxpZ2h0Y29yYWxcIjogWzI0MCwgMTI4LCAxMjhdLFxyXG5cdFwibGlnaHRjeWFuXCI6IFsyMjQsIDI1NSwgMjU1XSxcclxuXHRcImxpZ2h0Z29sZGVucm9keWVsbG93XCI6IFsyNTAsIDI1MCwgMjEwXSxcclxuXHRcImxpZ2h0Z3JheVwiOiBbMjExLCAyMTEsIDIxMV0sXHJcblx0XCJsaWdodGdyZWVuXCI6IFsxNDQsIDIzOCwgMTQ0XSxcclxuXHRcImxpZ2h0Z3JleVwiOiBbMjExLCAyMTEsIDIxMV0sXHJcblx0XCJsaWdodHBpbmtcIjogWzI1NSwgMTgyLCAxOTNdLFxyXG5cdFwibGlnaHRzYWxtb25cIjogWzI1NSwgMTYwLCAxMjJdLFxyXG5cdFwibGlnaHRzZWFncmVlblwiOiBbMzIsIDE3OCwgMTcwXSxcclxuXHRcImxpZ2h0c2t5Ymx1ZVwiOiBbMTM1LCAyMDYsIDI1MF0sXHJcblx0XCJsaWdodHNsYXRlZ3JheVwiOiBbMTE5LCAxMzYsIDE1M10sXHJcblx0XCJsaWdodHNsYXRlZ3JleVwiOiBbMTE5LCAxMzYsIDE1M10sXHJcblx0XCJsaWdodHN0ZWVsYmx1ZVwiOiBbMTc2LCAxOTYsIDIyMl0sXHJcblx0XCJsaWdodHllbGxvd1wiOiBbMjU1LCAyNTUsIDIyNF0sXHJcblx0XCJsaW1lXCI6IFswLCAyNTUsIDBdLFxyXG5cdFwibGltZWdyZWVuXCI6IFs1MCwgMjA1LCA1MF0sXHJcblx0XCJsaW5lblwiOiBbMjUwLCAyNDAsIDIzMF0sXHJcblx0XCJtYWdlbnRhXCI6IFsyNTUsIDAsIDI1NV0sXHJcblx0XCJtYXJvb25cIjogWzEyOCwgMCwgMF0sXHJcblx0XCJtZWRpdW1hcXVhbWFyaW5lXCI6IFsxMDIsIDIwNSwgMTcwXSxcclxuXHRcIm1lZGl1bWJsdWVcIjogWzAsIDAsIDIwNV0sXHJcblx0XCJtZWRpdW1vcmNoaWRcIjogWzE4NiwgODUsIDIxMV0sXHJcblx0XCJtZWRpdW1wdXJwbGVcIjogWzE0NywgMTEyLCAyMTldLFxyXG5cdFwibWVkaXVtc2VhZ3JlZW5cIjogWzYwLCAxNzksIDExM10sXHJcblx0XCJtZWRpdW1zbGF0ZWJsdWVcIjogWzEyMywgMTA0LCAyMzhdLFxyXG5cdFwibWVkaXVtc3ByaW5nZ3JlZW5cIjogWzAsIDI1MCwgMTU0XSxcclxuXHRcIm1lZGl1bXR1cnF1b2lzZVwiOiBbNzIsIDIwOSwgMjA0XSxcclxuXHRcIm1lZGl1bXZpb2xldHJlZFwiOiBbMTk5LCAyMSwgMTMzXSxcclxuXHRcIm1pZG5pZ2h0Ymx1ZVwiOiBbMjUsIDI1LCAxMTJdLFxyXG5cdFwibWludGNyZWFtXCI6IFsyNDUsIDI1NSwgMjUwXSxcclxuXHRcIm1pc3R5cm9zZVwiOiBbMjU1LCAyMjgsIDIyNV0sXHJcblx0XCJtb2NjYXNpblwiOiBbMjU1LCAyMjgsIDE4MV0sXHJcblx0XCJuYXZham93aGl0ZVwiOiBbMjU1LCAyMjIsIDE3M10sXHJcblx0XCJuYXZ5XCI6IFswLCAwLCAxMjhdLFxyXG5cdFwib2xkbGFjZVwiOiBbMjUzLCAyNDUsIDIzMF0sXHJcblx0XCJvbGl2ZVwiOiBbMTI4LCAxMjgsIDBdLFxyXG5cdFwib2xpdmVkcmFiXCI6IFsxMDcsIDE0MiwgMzVdLFxyXG5cdFwib3JhbmdlXCI6IFsyNTUsIDE2NSwgMF0sXHJcblx0XCJvcmFuZ2VyZWRcIjogWzI1NSwgNjksIDBdLFxyXG5cdFwib3JjaGlkXCI6IFsyMTgsIDExMiwgMjE0XSxcclxuXHRcInBhbGVnb2xkZW5yb2RcIjogWzIzOCwgMjMyLCAxNzBdLFxyXG5cdFwicGFsZWdyZWVuXCI6IFsxNTIsIDI1MSwgMTUyXSxcclxuXHRcInBhbGV0dXJxdW9pc2VcIjogWzE3NSwgMjM4LCAyMzhdLFxyXG5cdFwicGFsZXZpb2xldHJlZFwiOiBbMjE5LCAxMTIsIDE0N10sXHJcblx0XCJwYXBheWF3aGlwXCI6IFsyNTUsIDIzOSwgMjEzXSxcclxuXHRcInBlYWNocHVmZlwiOiBbMjU1LCAyMTgsIDE4NV0sXHJcblx0XCJwZXJ1XCI6IFsyMDUsIDEzMywgNjNdLFxyXG5cdFwicGlua1wiOiBbMjU1LCAxOTIsIDIwM10sXHJcblx0XCJwbHVtXCI6IFsyMjEsIDE2MCwgMjIxXSxcclxuXHRcInBvd2RlcmJsdWVcIjogWzE3NiwgMjI0LCAyMzBdLFxyXG5cdFwicHVycGxlXCI6IFsxMjgsIDAsIDEyOF0sXHJcblx0XCJyZWJlY2NhcHVycGxlXCI6IFsxMDIsIDUxLCAxNTNdLFxyXG5cdFwicmVkXCI6IFsyNTUsIDAsIDBdLFxyXG5cdFwicm9zeWJyb3duXCI6IFsxODgsIDE0MywgMTQzXSxcclxuXHRcInJveWFsYmx1ZVwiOiBbNjUsIDEwNSwgMjI1XSxcclxuXHRcInNhZGRsZWJyb3duXCI6IFsxMzksIDY5LCAxOV0sXHJcblx0XCJzYWxtb25cIjogWzI1MCwgMTI4LCAxMTRdLFxyXG5cdFwic2FuZHlicm93blwiOiBbMjQ0LCAxNjQsIDk2XSxcclxuXHRcInNlYWdyZWVuXCI6IFs0NiwgMTM5LCA4N10sXHJcblx0XCJzZWFzaGVsbFwiOiBbMjU1LCAyNDUsIDIzOF0sXHJcblx0XCJzaWVubmFcIjogWzE2MCwgODIsIDQ1XSxcclxuXHRcInNpbHZlclwiOiBbMTkyLCAxOTIsIDE5Ml0sXHJcblx0XCJza3libHVlXCI6IFsxMzUsIDIwNiwgMjM1XSxcclxuXHRcInNsYXRlYmx1ZVwiOiBbMTA2LCA5MCwgMjA1XSxcclxuXHRcInNsYXRlZ3JheVwiOiBbMTEyLCAxMjgsIDE0NF0sXHJcblx0XCJzbGF0ZWdyZXlcIjogWzExMiwgMTI4LCAxNDRdLFxyXG5cdFwic25vd1wiOiBbMjU1LCAyNTAsIDI1MF0sXHJcblx0XCJzcHJpbmdncmVlblwiOiBbMCwgMjU1LCAxMjddLFxyXG5cdFwic3RlZWxibHVlXCI6IFs3MCwgMTMwLCAxODBdLFxyXG5cdFwidGFuXCI6IFsyMTAsIDE4MCwgMTQwXSxcclxuXHRcInRlYWxcIjogWzAsIDEyOCwgMTI4XSxcclxuXHRcInRoaXN0bGVcIjogWzIxNiwgMTkxLCAyMTZdLFxyXG5cdFwidG9tYXRvXCI6IFsyNTUsIDk5LCA3MV0sXHJcblx0XCJ0dXJxdW9pc2VcIjogWzY0LCAyMjQsIDIwOF0sXHJcblx0XCJ2aW9sZXRcIjogWzIzOCwgMTMwLCAyMzhdLFxyXG5cdFwid2hlYXRcIjogWzI0NSwgMjIyLCAxNzldLFxyXG5cdFwid2hpdGVcIjogWzI1NSwgMjU1LCAyNTVdLFxyXG5cdFwid2hpdGVzbW9rZVwiOiBbMjQ1LCAyNDUsIDI0NV0sXHJcblx0XCJ5ZWxsb3dcIjogWzI1NSwgMjU1LCAwXSxcclxuXHRcInllbGxvd2dyZWVuXCI6IFsxNTQsIDIwNSwgNTBdXHJcbn07XHJcbiIsInZhciBjb252ZXJzaW9ucyA9IHJlcXVpcmUoJy4vY29udmVyc2lvbnMnKTtcblxuLypcblx0dGhpcyBmdW5jdGlvbiByb3V0ZXMgYSBtb2RlbCB0byBhbGwgb3RoZXIgbW9kZWxzLlxuXG5cdGFsbCBmdW5jdGlvbnMgdGhhdCBhcmUgcm91dGVkIGhhdmUgYSBwcm9wZXJ0eSBgLmNvbnZlcnNpb25gIGF0dGFjaGVkXG5cdHRvIHRoZSByZXR1cm5lZCBzeW50aGV0aWMgZnVuY3Rpb24uIFRoaXMgcHJvcGVydHkgaXMgYW4gYXJyYXlcblx0b2Ygc3RyaW5ncywgZWFjaCB3aXRoIHRoZSBzdGVwcyBpbiBiZXR3ZWVuIHRoZSAnZnJvbScgYW5kICd0bydcblx0Y29sb3IgbW9kZWxzIChpbmNsdXNpdmUpLlxuXG5cdGNvbnZlcnNpb25zIHRoYXQgYXJlIG5vdCBwb3NzaWJsZSBzaW1wbHkgYXJlIG5vdCBpbmNsdWRlZC5cbiovXG5cbmZ1bmN0aW9uIGJ1aWxkR3JhcGgoKSB7XG5cdHZhciBncmFwaCA9IHt9O1xuXHQvLyBodHRwczovL2pzcGVyZi5jb20vb2JqZWN0LWtleXMtdnMtZm9yLWluLXdpdGgtY2xvc3VyZS8zXG5cdHZhciBtb2RlbHMgPSBPYmplY3Qua2V5cyhjb252ZXJzaW9ucyk7XG5cblx0Zm9yICh2YXIgbGVuID0gbW9kZWxzLmxlbmd0aCwgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdGdyYXBoW21vZGVsc1tpXV0gPSB7XG5cdFx0XHQvLyBodHRwOi8vanNwZXJmLmNvbS8xLXZzLWluZmluaXR5XG5cdFx0XHQvLyBtaWNyby1vcHQsIGJ1dCB0aGlzIGlzIHNpbXBsZS5cblx0XHRcdGRpc3RhbmNlOiAtMSxcblx0XHRcdHBhcmVudDogbnVsbFxuXHRcdH07XG5cdH1cblxuXHRyZXR1cm4gZ3JhcGg7XG59XG5cbi8vIGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0JyZWFkdGgtZmlyc3Rfc2VhcmNoXG5mdW5jdGlvbiBkZXJpdmVCRlMoZnJvbU1vZGVsKSB7XG5cdHZhciBncmFwaCA9IGJ1aWxkR3JhcGgoKTtcblx0dmFyIHF1ZXVlID0gW2Zyb21Nb2RlbF07IC8vIHVuc2hpZnQgLT4gcXVldWUgLT4gcG9wXG5cblx0Z3JhcGhbZnJvbU1vZGVsXS5kaXN0YW5jZSA9IDA7XG5cblx0d2hpbGUgKHF1ZXVlLmxlbmd0aCkge1xuXHRcdHZhciBjdXJyZW50ID0gcXVldWUucG9wKCk7XG5cdFx0dmFyIGFkamFjZW50cyA9IE9iamVjdC5rZXlzKGNvbnZlcnNpb25zW2N1cnJlbnRdKTtcblxuXHRcdGZvciAodmFyIGxlbiA9IGFkamFjZW50cy5sZW5ndGgsIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcblx0XHRcdHZhciBhZGphY2VudCA9IGFkamFjZW50c1tpXTtcblx0XHRcdHZhciBub2RlID0gZ3JhcGhbYWRqYWNlbnRdO1xuXG5cdFx0XHRpZiAobm9kZS5kaXN0YW5jZSA9PT0gLTEpIHtcblx0XHRcdFx0bm9kZS5kaXN0YW5jZSA9IGdyYXBoW2N1cnJlbnRdLmRpc3RhbmNlICsgMTtcblx0XHRcdFx0bm9kZS5wYXJlbnQgPSBjdXJyZW50O1xuXHRcdFx0XHRxdWV1ZS51bnNoaWZ0KGFkamFjZW50KTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gZ3JhcGg7XG59XG5cbmZ1bmN0aW9uIGxpbmsoZnJvbSwgdG8pIHtcblx0cmV0dXJuIGZ1bmN0aW9uIChhcmdzKSB7XG5cdFx0cmV0dXJuIHRvKGZyb20oYXJncykpO1xuXHR9O1xufVxuXG5mdW5jdGlvbiB3cmFwQ29udmVyc2lvbih0b01vZGVsLCBncmFwaCkge1xuXHR2YXIgcGF0aCA9IFtncmFwaFt0b01vZGVsXS5wYXJlbnQsIHRvTW9kZWxdO1xuXHR2YXIgZm4gPSBjb252ZXJzaW9uc1tncmFwaFt0b01vZGVsXS5wYXJlbnRdW3RvTW9kZWxdO1xuXG5cdHZhciBjdXIgPSBncmFwaFt0b01vZGVsXS5wYXJlbnQ7XG5cdHdoaWxlIChncmFwaFtjdXJdLnBhcmVudCkge1xuXHRcdHBhdGgudW5zaGlmdChncmFwaFtjdXJdLnBhcmVudCk7XG5cdFx0Zm4gPSBsaW5rKGNvbnZlcnNpb25zW2dyYXBoW2N1cl0ucGFyZW50XVtjdXJdLCBmbik7XG5cdFx0Y3VyID0gZ3JhcGhbY3VyXS5wYXJlbnQ7XG5cdH1cblxuXHRmbi5jb252ZXJzaW9uID0gcGF0aDtcblx0cmV0dXJuIGZuO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChmcm9tTW9kZWwpIHtcblx0dmFyIGdyYXBoID0gZGVyaXZlQkZTKGZyb21Nb2RlbCk7XG5cdHZhciBjb252ZXJzaW9uID0ge307XG5cblx0dmFyIG1vZGVscyA9IE9iamVjdC5rZXlzKGdyYXBoKTtcblx0Zm9yICh2YXIgbGVuID0gbW9kZWxzLmxlbmd0aCwgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdHZhciB0b01vZGVsID0gbW9kZWxzW2ldO1xuXHRcdHZhciBub2RlID0gZ3JhcGhbdG9Nb2RlbF07XG5cblx0XHRpZiAobm9kZS5wYXJlbnQgPT09IG51bGwpIHtcblx0XHRcdC8vIG5vIHBvc3NpYmxlIGNvbnZlcnNpb24sIG9yIHRoaXMgbm9kZSBpcyB0aGUgc291cmNlIG1vZGVsLlxuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXG5cdFx0Y29udmVyc2lvblt0b01vZGVsXSA9IHdyYXBDb252ZXJzaW9uKHRvTW9kZWwsIGdyYXBoKTtcblx0fVxuXG5cdHJldHVybiBjb252ZXJzaW9uO1xufTtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpO1xuY29uc3QgaGFzRmxhZyA9IHJlcXVpcmUoJ2hhcy1mbGFnJyk7XG5cbmNvbnN0IGVudiA9IHByb2Nlc3MuZW52O1xuXG5sZXQgZm9yY2VDb2xvcjtcbmlmIChoYXNGbGFnKCduby1jb2xvcicpIHx8XG5cdGhhc0ZsYWcoJ25vLWNvbG9ycycpIHx8XG5cdGhhc0ZsYWcoJ2NvbG9yPWZhbHNlJykpIHtcblx0Zm9yY2VDb2xvciA9IGZhbHNlO1xufSBlbHNlIGlmIChoYXNGbGFnKCdjb2xvcicpIHx8XG5cdGhhc0ZsYWcoJ2NvbG9ycycpIHx8XG5cdGhhc0ZsYWcoJ2NvbG9yPXRydWUnKSB8fFxuXHRoYXNGbGFnKCdjb2xvcj1hbHdheXMnKSkge1xuXHRmb3JjZUNvbG9yID0gdHJ1ZTtcbn1cbmlmICgnRk9SQ0VfQ09MT1InIGluIGVudikge1xuXHRmb3JjZUNvbG9yID0gZW52LkZPUkNFX0NPTE9SLmxlbmd0aCA9PT0gMCB8fCBwYXJzZUludChlbnYuRk9SQ0VfQ09MT1IsIDEwKSAhPT0gMDtcbn1cblxuZnVuY3Rpb24gdHJhbnNsYXRlTGV2ZWwobGV2ZWwpIHtcblx0aWYgKGxldmVsID09PSAwKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRsZXZlbCxcblx0XHRoYXNCYXNpYzogdHJ1ZSxcblx0XHRoYXMyNTY6IGxldmVsID49IDIsXG5cdFx0aGFzMTZtOiBsZXZlbCA+PSAzXG5cdH07XG59XG5cbmZ1bmN0aW9uIHN1cHBvcnRzQ29sb3Ioc3RyZWFtKSB7XG5cdGlmIChmb3JjZUNvbG9yID09PSBmYWxzZSkge1xuXHRcdHJldHVybiAwO1xuXHR9XG5cblx0aWYgKGhhc0ZsYWcoJ2NvbG9yPTE2bScpIHx8XG5cdFx0aGFzRmxhZygnY29sb3I9ZnVsbCcpIHx8XG5cdFx0aGFzRmxhZygnY29sb3I9dHJ1ZWNvbG9yJykpIHtcblx0XHRyZXR1cm4gMztcblx0fVxuXG5cdGlmIChoYXNGbGFnKCdjb2xvcj0yNTYnKSkge1xuXHRcdHJldHVybiAyO1xuXHR9XG5cblx0aWYgKHN0cmVhbSAmJiAhc3RyZWFtLmlzVFRZICYmIGZvcmNlQ29sb3IgIT09IHRydWUpIHtcblx0XHRyZXR1cm4gMDtcblx0fVxuXG5cdGNvbnN0IG1pbiA9IGZvcmNlQ29sb3IgPyAxIDogMDtcblxuXHRpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuXHRcdC8vIE5vZGUuanMgNy41LjAgaXMgdGhlIGZpcnN0IHZlcnNpb24gb2YgTm9kZS5qcyB0byBpbmNsdWRlIGEgcGF0Y2ggdG9cblx0XHQvLyBsaWJ1diB0aGF0IGVuYWJsZXMgMjU2IGNvbG9yIG91dHB1dCBvbiBXaW5kb3dzLiBBbnl0aGluZyBlYXJsaWVyIGFuZCBpdFxuXHRcdC8vIHdvbid0IHdvcmsuIEhvd2V2ZXIsIGhlcmUgd2UgdGFyZ2V0IE5vZGUuanMgOCBhdCBtaW5pbXVtIGFzIGl0IGlzIGFuIExUU1xuXHRcdC8vIHJlbGVhc2UsIGFuZCBOb2RlLmpzIDcgaXMgbm90LiBXaW5kb3dzIDEwIGJ1aWxkIDEwNTg2IGlzIHRoZSBmaXJzdCBXaW5kb3dzXG5cdFx0Ly8gcmVsZWFzZSB0aGF0IHN1cHBvcnRzIDI1NiBjb2xvcnMuIFdpbmRvd3MgMTAgYnVpbGQgMTQ5MzEgaXMgdGhlIGZpcnN0IHJlbGVhc2Vcblx0XHQvLyB0aGF0IHN1cHBvcnRzIDE2bS9UcnVlQ29sb3IuXG5cdFx0Y29uc3Qgb3NSZWxlYXNlID0gb3MucmVsZWFzZSgpLnNwbGl0KCcuJyk7XG5cdFx0aWYgKFxuXHRcdFx0TnVtYmVyKHByb2Nlc3MudmVyc2lvbnMubm9kZS5zcGxpdCgnLicpWzBdKSA+PSA4ICYmXG5cdFx0XHROdW1iZXIob3NSZWxlYXNlWzBdKSA+PSAxMCAmJlxuXHRcdFx0TnVtYmVyKG9zUmVsZWFzZVsyXSkgPj0gMTA1ODZcblx0XHQpIHtcblx0XHRcdHJldHVybiBOdW1iZXIob3NSZWxlYXNlWzJdKSA+PSAxNDkzMSA/IDMgOiAyO1xuXHRcdH1cblxuXHRcdHJldHVybiAxO1xuXHR9XG5cblx0aWYgKCdDSScgaW4gZW52KSB7XG5cdFx0aWYgKFsnVFJBVklTJywgJ0NJUkNMRUNJJywgJ0FQUFZFWU9SJywgJ0dJVExBQl9DSSddLnNvbWUoc2lnbiA9PiBzaWduIGluIGVudikgfHwgZW52LkNJX05BTUUgPT09ICdjb2Rlc2hpcCcpIHtcblx0XHRcdHJldHVybiAxO1xuXHRcdH1cblxuXHRcdHJldHVybiBtaW47XG5cdH1cblxuXHRpZiAoJ1RFQU1DSVRZX1ZFUlNJT04nIGluIGVudikge1xuXHRcdHJldHVybiAvXig5XFwuKDAqWzEtOV1cXGQqKVxcLnxcXGR7Mix9XFwuKS8udGVzdChlbnYuVEVBTUNJVFlfVkVSU0lPTikgPyAxIDogMDtcblx0fVxuXG5cdGlmIChlbnYuQ09MT1JURVJNID09PSAndHJ1ZWNvbG9yJykge1xuXHRcdHJldHVybiAzO1xuXHR9XG5cblx0aWYgKCdURVJNX1BST0dSQU0nIGluIGVudikge1xuXHRcdGNvbnN0IHZlcnNpb24gPSBwYXJzZUludCgoZW52LlRFUk1fUFJPR1JBTV9WRVJTSU9OIHx8ICcnKS5zcGxpdCgnLicpWzBdLCAxMCk7XG5cblx0XHRzd2l0Y2ggKGVudi5URVJNX1BST0dSQU0pIHtcblx0XHRcdGNhc2UgJ2lUZXJtLmFwcCc6XG5cdFx0XHRcdHJldHVybiB2ZXJzaW9uID49IDMgPyAzIDogMjtcblx0XHRcdGNhc2UgJ0FwcGxlX1Rlcm1pbmFsJzpcblx0XHRcdFx0cmV0dXJuIDI7XG5cdFx0XHQvLyBObyBkZWZhdWx0XG5cdFx0fVxuXHR9XG5cblx0aWYgKC8tMjU2KGNvbG9yKT8kL2kudGVzdChlbnYuVEVSTSkpIHtcblx0XHRyZXR1cm4gMjtcblx0fVxuXG5cdGlmICgvXnNjcmVlbnxeeHRlcm18XnZ0MTAwfF52dDIyMHxecnh2dHxjb2xvcnxhbnNpfGN5Z3dpbnxsaW51eC9pLnRlc3QoZW52LlRFUk0pKSB7XG5cdFx0cmV0dXJuIDE7XG5cdH1cblxuXHRpZiAoJ0NPTE9SVEVSTScgaW4gZW52KSB7XG5cdFx0cmV0dXJuIDE7XG5cdH1cblxuXHRpZiAoZW52LlRFUk0gPT09ICdkdW1iJykge1xuXHRcdHJldHVybiBtaW47XG5cdH1cblxuXHRyZXR1cm4gbWluO1xufVxuXG5mdW5jdGlvbiBnZXRTdXBwb3J0TGV2ZWwoc3RyZWFtKSB7XG5cdGNvbnN0IGxldmVsID0gc3VwcG9ydHNDb2xvcihzdHJlYW0pO1xuXHRyZXR1cm4gdHJhbnNsYXRlTGV2ZWwobGV2ZWwpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0c3VwcG9ydHNDb2xvcjogZ2V0U3VwcG9ydExldmVsLFxuXHRzdGRvdXQ6IGdldFN1cHBvcnRMZXZlbChwcm9jZXNzLnN0ZG91dCksXG5cdHN0ZGVycjogZ2V0U3VwcG9ydExldmVsKHByb2Nlc3Muc3RkZXJyKVxufTtcbiIsIid1c2Ugc3RyaWN0Jztcbm1vZHVsZS5leHBvcnRzID0gKGZsYWcsIGFyZ3YpID0+IHtcblx0YXJndiA9IGFyZ3YgfHwgcHJvY2Vzcy5hcmd2O1xuXHRjb25zdCBwcmVmaXggPSBmbGFnLnN0YXJ0c1dpdGgoJy0nKSA/ICcnIDogKGZsYWcubGVuZ3RoID09PSAxID8gJy0nIDogJy0tJyk7XG5cdGNvbnN0IHBvcyA9IGFyZ3YuaW5kZXhPZihwcmVmaXggKyBmbGFnKTtcblx0Y29uc3QgdGVybWluYXRvclBvcyA9IGFyZ3YuaW5kZXhPZignLS0nKTtcblx0cmV0dXJuIHBvcyAhPT0gLTEgJiYgKHRlcm1pbmF0b3JQb3MgPT09IC0xID8gdHJ1ZSA6IHBvcyA8IHRlcm1pbmF0b3JQb3MpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbmNvbnN0IFRFTVBMQVRFX1JFR0VYID0gLyg/OlxcXFwodVthLWZcXGRdezR9fHhbYS1mXFxkXXsyfXwuKSl8KD86XFx7KH4pPyhcXHcrKD86XFwoW14pXSpcXCkpPyg/OlxcLlxcdysoPzpcXChbXildKlxcKSk/KSopKD86WyBcXHRdfCg/PVxccj9cXG4pKSl8KFxcfSl8KCg/Oi58W1xcclxcblxcZl0pKz8pL2dpO1xuY29uc3QgU1RZTEVfUkVHRVggPSAvKD86XnxcXC4pKFxcdyspKD86XFwoKFteKV0qKVxcKSk/L2c7XG5jb25zdCBTVFJJTkdfUkVHRVggPSAvXihbJ1wiXSkoKD86XFxcXC58KD8hXFwxKVteXFxcXF0pKilcXDEkLztcbmNvbnN0IEVTQ0FQRV9SRUdFWCA9IC9cXFxcKHVbYS1mXFxkXXs0fXx4W2EtZlxcZF17Mn18Lil8KFteXFxcXF0pL2dpO1xuXG5jb25zdCBFU0NBUEVTID0gbmV3IE1hcChbXG5cdFsnbicsICdcXG4nXSxcblx0WydyJywgJ1xcciddLFxuXHRbJ3QnLCAnXFx0J10sXG5cdFsnYicsICdcXGInXSxcblx0WydmJywgJ1xcZiddLFxuXHRbJ3YnLCAnXFx2J10sXG5cdFsnMCcsICdcXDAnXSxcblx0WydcXFxcJywgJ1xcXFwnXSxcblx0WydlJywgJ1xcdTAwMUInXSxcblx0WydhJywgJ1xcdTAwMDcnXVxuXSk7XG5cbmZ1bmN0aW9uIHVuZXNjYXBlKGMpIHtcblx0aWYgKChjWzBdID09PSAndScgJiYgYy5sZW5ndGggPT09IDUpIHx8IChjWzBdID09PSAneCcgJiYgYy5sZW5ndGggPT09IDMpKSB7XG5cdFx0cmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoYy5zbGljZSgxKSwgMTYpKTtcblx0fVxuXG5cdHJldHVybiBFU0NBUEVTLmdldChjKSB8fCBjO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFyZ3VtZW50cyhuYW1lLCBhcmdzKSB7XG5cdGNvbnN0IHJlc3VsdHMgPSBbXTtcblx0Y29uc3QgY2h1bmtzID0gYXJncy50cmltKCkuc3BsaXQoL1xccyosXFxzKi9nKTtcblx0bGV0IG1hdGNoZXM7XG5cblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcblx0XHRpZiAoIWlzTmFOKGNodW5rKSkge1xuXHRcdFx0cmVzdWx0cy5wdXNoKE51bWJlcihjaHVuaykpO1xuXHRcdH0gZWxzZSBpZiAoKG1hdGNoZXMgPSBjaHVuay5tYXRjaChTVFJJTkdfUkVHRVgpKSkge1xuXHRcdFx0cmVzdWx0cy5wdXNoKG1hdGNoZXNbMl0ucmVwbGFjZShFU0NBUEVfUkVHRVgsIChtLCBlc2NhcGUsIGNocikgPT4gZXNjYXBlID8gdW5lc2NhcGUoZXNjYXBlKSA6IGNocikpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgQ2hhbGsgdGVtcGxhdGUgc3R5bGUgYXJndW1lbnQ6ICR7Y2h1bmt9IChpbiBzdHlsZSAnJHtuYW1lfScpYCk7XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU3R5bGUoc3R5bGUpIHtcblx0U1RZTEVfUkVHRVgubGFzdEluZGV4ID0gMDtcblxuXHRjb25zdCByZXN1bHRzID0gW107XG5cdGxldCBtYXRjaGVzO1xuXG5cdHdoaWxlICgobWF0Y2hlcyA9IFNUWUxFX1JFR0VYLmV4ZWMoc3R5bGUpKSAhPT0gbnVsbCkge1xuXHRcdGNvbnN0IG5hbWUgPSBtYXRjaGVzWzFdO1xuXG5cdFx0aWYgKG1hdGNoZXNbMl0pIHtcblx0XHRcdGNvbnN0IGFyZ3MgPSBwYXJzZUFyZ3VtZW50cyhuYW1lLCBtYXRjaGVzWzJdKTtcblx0XHRcdHJlc3VsdHMucHVzaChbbmFtZV0uY29uY2F0KGFyZ3MpKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmVzdWx0cy5wdXNoKFtuYW1lXSk7XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkU3R5bGUoY2hhbGssIHN0eWxlcykge1xuXHRjb25zdCBlbmFibGVkID0ge307XG5cblx0Zm9yIChjb25zdCBsYXllciBvZiBzdHlsZXMpIHtcblx0XHRmb3IgKGNvbnN0IHN0eWxlIG9mIGxheWVyLnN0eWxlcykge1xuXHRcdFx0ZW5hYmxlZFtzdHlsZVswXV0gPSBsYXllci5pbnZlcnNlID8gbnVsbCA6IHN0eWxlLnNsaWNlKDEpO1xuXHRcdH1cblx0fVxuXG5cdGxldCBjdXJyZW50ID0gY2hhbGs7XG5cdGZvciAoY29uc3Qgc3R5bGVOYW1lIG9mIE9iamVjdC5rZXlzKGVuYWJsZWQpKSB7XG5cdFx0aWYgKEFycmF5LmlzQXJyYXkoZW5hYmxlZFtzdHlsZU5hbWVdKSkge1xuXHRcdFx0aWYgKCEoc3R5bGVOYW1lIGluIGN1cnJlbnQpKSB7XG5cdFx0XHRcdHRocm93IG5ldyBFcnJvcihgVW5rbm93biBDaGFsayBzdHlsZTogJHtzdHlsZU5hbWV9YCk7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChlbmFibGVkW3N0eWxlTmFtZV0ubGVuZ3RoID4gMCkge1xuXHRcdFx0XHRjdXJyZW50ID0gY3VycmVudFtzdHlsZU5hbWVdLmFwcGx5KGN1cnJlbnQsIGVuYWJsZWRbc3R5bGVOYW1lXSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjdXJyZW50ID0gY3VycmVudFtzdHlsZU5hbWVdO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdHJldHVybiBjdXJyZW50O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IChjaGFsaywgdG1wKSA9PiB7XG5cdGNvbnN0IHN0eWxlcyA9IFtdO1xuXHRjb25zdCBjaHVua3MgPSBbXTtcblx0bGV0IGNodW5rID0gW107XG5cblx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1wYXJhbXNcblx0dG1wLnJlcGxhY2UoVEVNUExBVEVfUkVHRVgsIChtLCBlc2NhcGVDaGFyLCBpbnZlcnNlLCBzdHlsZSwgY2xvc2UsIGNocikgPT4ge1xuXHRcdGlmIChlc2NhcGVDaGFyKSB7XG5cdFx0XHRjaHVuay5wdXNoKHVuZXNjYXBlKGVzY2FwZUNoYXIpKTtcblx0XHR9IGVsc2UgaWYgKHN0eWxlKSB7XG5cdFx0XHRjb25zdCBzdHIgPSBjaHVuay5qb2luKCcnKTtcblx0XHRcdGNodW5rID0gW107XG5cdFx0XHRjaHVua3MucHVzaChzdHlsZXMubGVuZ3RoID09PSAwID8gc3RyIDogYnVpbGRTdHlsZShjaGFsaywgc3R5bGVzKShzdHIpKTtcblx0XHRcdHN0eWxlcy5wdXNoKHtpbnZlcnNlLCBzdHlsZXM6IHBhcnNlU3R5bGUoc3R5bGUpfSk7XG5cdFx0fSBlbHNlIGlmIChjbG9zZSkge1xuXHRcdFx0aWYgKHN0eWxlcy5sZW5ndGggPT09IDApIHtcblx0XHRcdFx0dGhyb3cgbmV3IEVycm9yKCdGb3VuZCBleHRyYW5lb3VzIH0gaW4gQ2hhbGsgdGVtcGxhdGUgbGl0ZXJhbCcpO1xuXHRcdFx0fVxuXG5cdFx0XHRjaHVua3MucHVzaChidWlsZFN0eWxlKGNoYWxrLCBzdHlsZXMpKGNodW5rLmpvaW4oJycpKSk7XG5cdFx0XHRjaHVuayA9IFtdO1xuXHRcdFx0c3R5bGVzLnBvcCgpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRjaHVuay5wdXNoKGNocik7XG5cdFx0fVxuXHR9KTtcblxuXHRjaHVua3MucHVzaChjaHVuay5qb2luKCcnKSk7XG5cblx0aWYgKHN0eWxlcy5sZW5ndGggPiAwKSB7XG5cdFx0Y29uc3QgZXJyTXNnID0gYENoYWxrIHRlbXBsYXRlIGxpdGVyYWwgaXMgbWlzc2luZyAke3N0eWxlcy5sZW5ndGh9IGNsb3NpbmcgYnJhY2tldCR7c3R5bGVzLmxlbmd0aCA9PT0gMSA/ICcnIDogJ3MnfSAoXFxgfVxcYClgO1xuXHRcdHRocm93IG5ldyBFcnJvcihlcnJNc2cpO1xuXHR9XG5cblx0cmV0dXJuIGNodW5rcy5qb2luKCcnKTtcbn07XG4iLCIvKlxuICogRGF0ZSBGb3JtYXQgMS4yLjNcbiAqIChjKSAyMDA3LTIwMDkgU3RldmVuIExldml0aGFuIDxzdGV2ZW5sZXZpdGhhbi5jb20+XG4gKiBNSVQgbGljZW5zZVxuICpcbiAqIEluY2x1ZGVzIGVuaGFuY2VtZW50cyBieSBTY290dCBUcmVuZGEgPHNjb3R0LnRyZW5kYS5uZXQ+XG4gKiBhbmQgS3JpcyBLb3dhbCA8Y2l4YXIuY29tL35rcmlzLmtvd2FsLz5cbiAqXG4gKiBBY2NlcHRzIGEgZGF0ZSwgYSBtYXNrLCBvciBhIGRhdGUgYW5kIGEgbWFzay5cbiAqIFJldHVybnMgYSBmb3JtYXR0ZWQgdmVyc2lvbiBvZiB0aGUgZ2l2ZW4gZGF0ZS5cbiAqIFRoZSBkYXRlIGRlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGRhdGUvdGltZS5cbiAqIFRoZSBtYXNrIGRlZmF1bHRzIHRvIGRhdGVGb3JtYXQubWFza3MuZGVmYXVsdC5cbiAqL1xuXG4oZnVuY3Rpb24oZ2xvYmFsKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgZGF0ZUZvcm1hdCA9IChmdW5jdGlvbigpIHtcbiAgICAgIHZhciB0b2tlbiA9IC9kezEsNH18bXsxLDR9fHl5KD86eXkpP3woW0hoTXNUdF0pXFwxP3xbTGxvU1pXTl18XCJbXlwiXSpcInwnW14nXSonL2c7XG4gICAgICB2YXIgdGltZXpvbmUgPSAvXFxiKD86W1BNQ0VBXVtTRFBdVHwoPzpQYWNpZmljfE1vdW50YWlufENlbnRyYWx8RWFzdGVybnxBdGxhbnRpYykgKD86U3RhbmRhcmR8RGF5bGlnaHR8UHJldmFpbGluZykgVGltZXwoPzpHTVR8VVRDKSg/OlstK11cXGR7NH0pPylcXGIvZztcbiAgICAgIHZhciB0aW1lem9uZUNsaXAgPSAvW14tK1xcZEEtWl0vZztcbiAgXG4gICAgICAvLyBSZWdleGVzIGFuZCBzdXBwb3J0aW5nIGZ1bmN0aW9ucyBhcmUgY2FjaGVkIHRocm91Z2ggY2xvc3VyZVxuICAgICAgcmV0dXJuIGZ1bmN0aW9uIChkYXRlLCBtYXNrLCB1dGMsIGdtdCkge1xuICBcbiAgICAgICAgLy8gWW91IGNhbid0IHByb3ZpZGUgdXRjIGlmIHlvdSBza2lwIG90aGVyIGFyZ3MgKHVzZSB0aGUgJ1VUQzonIG1hc2sgcHJlZml4KVxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSAmJiBraW5kT2YoZGF0ZSkgPT09ICdzdHJpbmcnICYmICEvXFxkLy50ZXN0KGRhdGUpKSB7XG4gICAgICAgICAgbWFzayA9IGRhdGU7XG4gICAgICAgICAgZGF0ZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICBcbiAgICAgICAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGU7XG4gIFxuICAgICAgICBpZighKGRhdGUgaW5zdGFuY2VvZiBEYXRlKSkge1xuICAgICAgICAgIGRhdGUgPSBuZXcgRGF0ZShkYXRlKTtcbiAgICAgICAgfVxuICBcbiAgICAgICAgaWYgKGlzTmFOKGRhdGUpKSB7XG4gICAgICAgICAgdGhyb3cgVHlwZUVycm9yKCdJbnZhbGlkIGRhdGUnKTtcbiAgICAgICAgfVxuICBcbiAgICAgICAgbWFzayA9IFN0cmluZyhkYXRlRm9ybWF0Lm1hc2tzW21hc2tdIHx8IG1hc2sgfHwgZGF0ZUZvcm1hdC5tYXNrc1snZGVmYXVsdCddKTtcbiAgXG4gICAgICAgIC8vIEFsbG93IHNldHRpbmcgdGhlIHV0Yy9nbXQgYXJndW1lbnQgdmlhIHRoZSBtYXNrXG4gICAgICAgIHZhciBtYXNrU2xpY2UgPSBtYXNrLnNsaWNlKDAsIDQpO1xuICAgICAgICBpZiAobWFza1NsaWNlID09PSAnVVRDOicgfHwgbWFza1NsaWNlID09PSAnR01UOicpIHtcbiAgICAgICAgICBtYXNrID0gbWFzay5zbGljZSg0KTtcbiAgICAgICAgICB1dGMgPSB0cnVlO1xuICAgICAgICAgIGlmIChtYXNrU2xpY2UgPT09ICdHTVQ6Jykge1xuICAgICAgICAgICAgZ210ID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgXG4gICAgICAgIHZhciBfID0gdXRjID8gJ2dldFVUQycgOiAnZ2V0JztcbiAgICAgICAgdmFyIGQgPSBkYXRlW18gKyAnRGF0ZSddKCk7XG4gICAgICAgIHZhciBEID0gZGF0ZVtfICsgJ0RheSddKCk7XG4gICAgICAgIHZhciBtID0gZGF0ZVtfICsgJ01vbnRoJ10oKTtcbiAgICAgICAgdmFyIHkgPSBkYXRlW18gKyAnRnVsbFllYXInXSgpO1xuICAgICAgICB2YXIgSCA9IGRhdGVbXyArICdIb3VycyddKCk7XG4gICAgICAgIHZhciBNID0gZGF0ZVtfICsgJ01pbnV0ZXMnXSgpO1xuICAgICAgICB2YXIgcyA9IGRhdGVbXyArICdTZWNvbmRzJ10oKTtcbiAgICAgICAgdmFyIEwgPSBkYXRlW18gKyAnTWlsbGlzZWNvbmRzJ10oKTtcbiAgICAgICAgdmFyIG8gPSB1dGMgPyAwIDogZGF0ZS5nZXRUaW1lem9uZU9mZnNldCgpO1xuICAgICAgICB2YXIgVyA9IGdldFdlZWsoZGF0ZSk7XG4gICAgICAgIHZhciBOID0gZ2V0RGF5T2ZXZWVrKGRhdGUpO1xuICAgICAgICB2YXIgZmxhZ3MgPSB7XG4gICAgICAgICAgZDogICAgZCxcbiAgICAgICAgICBkZDogICBwYWQoZCksXG4gICAgICAgICAgZGRkOiAgZGF0ZUZvcm1hdC5pMThuLmRheU5hbWVzW0RdLFxuICAgICAgICAgIGRkZGQ6IGRhdGVGb3JtYXQuaTE4bi5kYXlOYW1lc1tEICsgN10sXG4gICAgICAgICAgbTogICAgbSArIDEsXG4gICAgICAgICAgbW06ICAgcGFkKG0gKyAxKSxcbiAgICAgICAgICBtbW06ICBkYXRlRm9ybWF0LmkxOG4ubW9udGhOYW1lc1ttXSxcbiAgICAgICAgICBtbW1tOiBkYXRlRm9ybWF0LmkxOG4ubW9udGhOYW1lc1ttICsgMTJdLFxuICAgICAgICAgIHl5OiAgIFN0cmluZyh5KS5zbGljZSgyKSxcbiAgICAgICAgICB5eXl5OiB5LFxuICAgICAgICAgIGg6ICAgIEggJSAxMiB8fCAxMixcbiAgICAgICAgICBoaDogICBwYWQoSCAlIDEyIHx8IDEyKSxcbiAgICAgICAgICBIOiAgICBILFxuICAgICAgICAgIEhIOiAgIHBhZChIKSxcbiAgICAgICAgICBNOiAgICBNLFxuICAgICAgICAgIE1NOiAgIHBhZChNKSxcbiAgICAgICAgICBzOiAgICBzLFxuICAgICAgICAgIHNzOiAgIHBhZChzKSxcbiAgICAgICAgICBsOiAgICBwYWQoTCwgMyksXG4gICAgICAgICAgTDogICAgcGFkKE1hdGgucm91bmQoTCAvIDEwKSksXG4gICAgICAgICAgdDogICAgSCA8IDEyID8gZGF0ZUZvcm1hdC5pMThuLnRpbWVOYW1lc1swXSA6IGRhdGVGb3JtYXQuaTE4bi50aW1lTmFtZXNbMV0sXG4gICAgICAgICAgdHQ6ICAgSCA8IDEyID8gZGF0ZUZvcm1hdC5pMThuLnRpbWVOYW1lc1syXSA6IGRhdGVGb3JtYXQuaTE4bi50aW1lTmFtZXNbM10sXG4gICAgICAgICAgVDogICAgSCA8IDEyID8gZGF0ZUZvcm1hdC5pMThuLnRpbWVOYW1lc1s0XSA6IGRhdGVGb3JtYXQuaTE4bi50aW1lTmFtZXNbNV0sXG4gICAgICAgICAgVFQ6ICAgSCA8IDEyID8gZGF0ZUZvcm1hdC5pMThuLnRpbWVOYW1lc1s2XSA6IGRhdGVGb3JtYXQuaTE4bi50aW1lTmFtZXNbN10sXG4gICAgICAgICAgWjogICAgZ210ID8gJ0dNVCcgOiB1dGMgPyAnVVRDJyA6IChTdHJpbmcoZGF0ZSkubWF0Y2godGltZXpvbmUpIHx8IFsnJ10pLnBvcCgpLnJlcGxhY2UodGltZXpvbmVDbGlwLCAnJyksXG4gICAgICAgICAgbzogICAgKG8gPiAwID8gJy0nIDogJysnKSArIHBhZChNYXRoLmZsb29yKE1hdGguYWJzKG8pIC8gNjApICogMTAwICsgTWF0aC5hYnMobykgJSA2MCwgNCksXG4gICAgICAgICAgUzogICAgWyd0aCcsICdzdCcsICduZCcsICdyZCddW2QgJSAxMCA+IDMgPyAwIDogKGQgJSAxMDAgLSBkICUgMTAgIT0gMTApICogZCAlIDEwXSxcbiAgICAgICAgICBXOiAgICBXLFxuICAgICAgICAgIE46ICAgIE5cbiAgICAgICAgfTtcbiAgXG4gICAgICAgIHJldHVybiBtYXNrLnJlcGxhY2UodG9rZW4sIGZ1bmN0aW9uIChtYXRjaCkge1xuICAgICAgICAgIGlmIChtYXRjaCBpbiBmbGFncykge1xuICAgICAgICAgICAgcmV0dXJuIGZsYWdzW21hdGNoXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG1hdGNoLnNsaWNlKDEsIG1hdGNoLmxlbmd0aCAtIDEpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSkoKTtcblxuICBkYXRlRm9ybWF0Lm1hc2tzID0ge1xuICAgICdkZWZhdWx0JzogICAgICAgICAgICAgICAnZGRkIG1tbSBkZCB5eXl5IEhIOk1NOnNzJyxcbiAgICAnc2hvcnREYXRlJzogICAgICAgICAgICAgJ20vZC95eScsXG4gICAgJ21lZGl1bURhdGUnOiAgICAgICAgICAgICdtbW0gZCwgeXl5eScsXG4gICAgJ2xvbmdEYXRlJzogICAgICAgICAgICAgICdtbW1tIGQsIHl5eXknLFxuICAgICdmdWxsRGF0ZSc6ICAgICAgICAgICAgICAnZGRkZCwgbW1tbSBkLCB5eXl5JyxcbiAgICAnc2hvcnRUaW1lJzogICAgICAgICAgICAgJ2g6TU0gVFQnLFxuICAgICdtZWRpdW1UaW1lJzogICAgICAgICAgICAnaDpNTTpzcyBUVCcsXG4gICAgJ2xvbmdUaW1lJzogICAgICAgICAgICAgICdoOk1NOnNzIFRUIFonLFxuICAgICdpc29EYXRlJzogICAgICAgICAgICAgICAneXl5eS1tbS1kZCcsXG4gICAgJ2lzb1RpbWUnOiAgICAgICAgICAgICAgICdISDpNTTpzcycsXG4gICAgJ2lzb0RhdGVUaW1lJzogICAgICAgICAgICd5eXl5LW1tLWRkXFwnVFxcJ0hIOk1NOnNzbycsXG4gICAgJ2lzb1V0Y0RhdGVUaW1lJzogICAgICAgICdVVEM6eXl5eS1tbS1kZFxcJ1RcXCdISDpNTTpzc1xcJ1pcXCcnLFxuICAgICdleHBpcmVzSGVhZGVyRm9ybWF0JzogICAnZGRkLCBkZCBtbW0geXl5eSBISDpNTTpzcyBaJ1xuICB9O1xuXG4gIC8vIEludGVybmF0aW9uYWxpemF0aW9uIHN0cmluZ3NcbiAgZGF0ZUZvcm1hdC5pMThuID0ge1xuICAgIGRheU5hbWVzOiBbXG4gICAgICAnU3VuJywgJ01vbicsICdUdWUnLCAnV2VkJywgJ1RodScsICdGcmknLCAnU2F0JyxcbiAgICAgICdTdW5kYXknLCAnTW9uZGF5JywgJ1R1ZXNkYXknLCAnV2VkbmVzZGF5JywgJ1RodXJzZGF5JywgJ0ZyaWRheScsICdTYXR1cmRheSdcbiAgICBdLFxuICAgIG1vbnRoTmFtZXM6IFtcbiAgICAgICdKYW4nLCAnRmViJywgJ01hcicsICdBcHInLCAnTWF5JywgJ0p1bicsICdKdWwnLCAnQXVnJywgJ1NlcCcsICdPY3QnLCAnTm92JywgJ0RlYycsXG4gICAgICAnSmFudWFyeScsICdGZWJydWFyeScsICdNYXJjaCcsICdBcHJpbCcsICdNYXknLCAnSnVuZScsICdKdWx5JywgJ0F1Z3VzdCcsICdTZXB0ZW1iZXInLCAnT2N0b2JlcicsICdOb3ZlbWJlcicsICdEZWNlbWJlcidcbiAgICBdLFxuICAgIHRpbWVOYW1lczogW1xuICAgICAgJ2EnLCAncCcsICdhbScsICdwbScsICdBJywgJ1AnLCAnQU0nLCAnUE0nXG4gICAgXVxuICB9O1xuXG5mdW5jdGlvbiBwYWQodmFsLCBsZW4pIHtcbiAgdmFsID0gU3RyaW5nKHZhbCk7XG4gIGxlbiA9IGxlbiB8fCAyO1xuICB3aGlsZSAodmFsLmxlbmd0aCA8IGxlbikge1xuICAgIHZhbCA9ICcwJyArIHZhbDtcbiAgfVxuICByZXR1cm4gdmFsO1xufVxuXG4vKipcbiAqIEdldCB0aGUgSVNPIDg2MDEgd2VlayBudW1iZXJcbiAqIEJhc2VkIG9uIGNvbW1lbnRzIGZyb21cbiAqIGh0dHA6Ly90ZWNoYmxvZy5wcm9jdXJpb3Mubmwvay9uNjE4L25ld3Mvdmlldy8zMzc5Ni8xNDg2My9DYWxjdWxhdGUtSVNPLTg2MDEtd2Vlay1hbmQteWVhci1pbi1qYXZhc2NyaXB0Lmh0bWxcbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9IGBkYXRlYFxuICogQHJldHVybiB7TnVtYmVyfVxuICovXG5mdW5jdGlvbiBnZXRXZWVrKGRhdGUpIHtcbiAgLy8gUmVtb3ZlIHRpbWUgY29tcG9uZW50cyBvZiBkYXRlXG4gIHZhciB0YXJnZXRUaHVyc2RheSA9IG5ldyBEYXRlKGRhdGUuZ2V0RnVsbFllYXIoKSwgZGF0ZS5nZXRNb250aCgpLCBkYXRlLmdldERhdGUoKSk7XG5cbiAgLy8gQ2hhbmdlIGRhdGUgdG8gVGh1cnNkYXkgc2FtZSB3ZWVrXG4gIHRhcmdldFRodXJzZGF5LnNldERhdGUodGFyZ2V0VGh1cnNkYXkuZ2V0RGF0ZSgpIC0gKCh0YXJnZXRUaHVyc2RheS5nZXREYXkoKSArIDYpICUgNykgKyAzKTtcblxuICAvLyBUYWtlIEphbnVhcnkgNHRoIGFzIGl0IGlzIGFsd2F5cyBpbiB3ZWVrIDEgKHNlZSBJU08gODYwMSlcbiAgdmFyIGZpcnN0VGh1cnNkYXkgPSBuZXcgRGF0ZSh0YXJnZXRUaHVyc2RheS5nZXRGdWxsWWVhcigpLCAwLCA0KTtcblxuICAvLyBDaGFuZ2UgZGF0ZSB0byBUaHVyc2RheSBzYW1lIHdlZWtcbiAgZmlyc3RUaHVyc2RheS5zZXREYXRlKGZpcnN0VGh1cnNkYXkuZ2V0RGF0ZSgpIC0gKChmaXJzdFRodXJzZGF5LmdldERheSgpICsgNikgJSA3KSArIDMpO1xuXG4gIC8vIENoZWNrIGlmIGRheWxpZ2h0LXNhdmluZy10aW1lLXN3aXRjaCBvY2N1cnJlZCBhbmQgY29ycmVjdCBmb3IgaXRcbiAgdmFyIGRzID0gdGFyZ2V0VGh1cnNkYXkuZ2V0VGltZXpvbmVPZmZzZXQoKSAtIGZpcnN0VGh1cnNkYXkuZ2V0VGltZXpvbmVPZmZzZXQoKTtcbiAgdGFyZ2V0VGh1cnNkYXkuc2V0SG91cnModGFyZ2V0VGh1cnNkYXkuZ2V0SG91cnMoKSAtIGRzKTtcblxuICAvLyBOdW1iZXIgb2Ygd2Vla3MgYmV0d2VlbiB0YXJnZXQgVGh1cnNkYXkgYW5kIGZpcnN0IFRodXJzZGF5XG4gIHZhciB3ZWVrRGlmZiA9ICh0YXJnZXRUaHVyc2RheSAtIGZpcnN0VGh1cnNkYXkpIC8gKDg2NDAwMDAwKjcpO1xuICByZXR1cm4gMSArIE1hdGguZmxvb3Iod2Vla0RpZmYpO1xufVxuXG4vKipcbiAqIEdldCBJU08tODYwMSBudW1lcmljIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkYXkgb2YgdGhlIHdlZWtcbiAqIDEgKGZvciBNb25kYXkpIHRocm91Z2ggNyAoZm9yIFN1bmRheSlcbiAqIFxuICogQHBhcmFtICB7T2JqZWN0fSBgZGF0ZWBcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqL1xuZnVuY3Rpb24gZ2V0RGF5T2ZXZWVrKGRhdGUpIHtcbiAgdmFyIGRvdyA9IGRhdGUuZ2V0RGF5KCk7XG4gIGlmKGRvdyA9PT0gMCkge1xuICAgIGRvdyA9IDc7XG4gIH1cbiAgcmV0dXJuIGRvdztcbn1cblxuLyoqXG4gKiBraW5kLW9mIHNob3J0Y3V0XG4gKiBAcGFyYW0gIHsqfSB2YWxcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuZnVuY3Rpb24ga2luZE9mKHZhbCkge1xuICBpZiAodmFsID09PSBudWxsKSB7XG4gICAgcmV0dXJuICdudWxsJztcbiAgfVxuXG4gIGlmICh2YWwgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiAndW5kZWZpbmVkJztcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiB0eXBlb2YgdmFsO1xuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgIHJldHVybiAnYXJyYXknO1xuICB9XG5cbiAgcmV0dXJuIHt9LnRvU3RyaW5nLmNhbGwodmFsKVxuICAgIC5zbGljZSg4LCAtMSkudG9Mb3dlckNhc2UoKTtcbn07XG5cblxuXG4gIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICBkZWZpbmUoZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIGRhdGVGb3JtYXQ7XG4gICAgfSk7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBkYXRlRm9ybWF0O1xuICB9IGVsc2Uge1xuICAgIGdsb2JhbC5kYXRlRm9ybWF0ID0gZGF0ZUZvcm1hdDtcbiAgfVxufSkodGhpcyk7XG4iLCIndXNlIHN0cmljdCdcblxuZnVuY3Rpb24gUGFyc2UgKGRhdGEpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFBhcnNlKSkge1xuICAgIHJldHVybiBuZXcgUGFyc2UoZGF0YSlcbiAgfVxuICB0aGlzLmVyciA9IG51bGxcbiAgdGhpcy52YWx1ZSA9IG51bGxcbiAgdHJ5IHtcbiAgICB0aGlzLnZhbHVlID0gSlNPTi5wYXJzZShkYXRhKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aGlzLmVyciA9IGVyclxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUGFyc2VcbiIsIihmdW5jdGlvbihleHBvcnRzKSB7XG4gIFwidXNlIHN0cmljdFwiO1xuXG4gIGZ1bmN0aW9uIGlzQXJyYXkob2JqKSB7XG4gICAgaWYgKG9iaiAhPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopID09PSBcIltvYmplY3QgQXJyYXldXCI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpc09iamVjdChvYmopIHtcbiAgICBpZiAob2JqICE9PSBudWxsKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09IFwiW29iamVjdCBPYmplY3RdXCI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzdHJpY3REZWVwRXF1YWwoZmlyc3QsIHNlY29uZCkge1xuICAgIC8vIENoZWNrIHRoZSBzY2FsYXIgY2FzZSBmaXJzdC5cbiAgICBpZiAoZmlyc3QgPT09IHNlY29uZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaWYgdGhleSBhcmUgdGhlIHNhbWUgdHlwZS5cbiAgICB2YXIgZmlyc3RUeXBlID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGZpcnN0KTtcbiAgICBpZiAoZmlyc3RUeXBlICE9PSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoc2Vjb25kKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICAvLyBXZSBrbm93IHRoYXQgZmlyc3QgYW5kIHNlY29uZCBoYXZlIHRoZSBzYW1lIHR5cGUgc28gd2UgY2FuIGp1c3QgY2hlY2sgdGhlXG4gICAgLy8gZmlyc3QgdHlwZSBmcm9tIG5vdyBvbi5cbiAgICBpZiAoaXNBcnJheShmaXJzdCkgPT09IHRydWUpIHtcbiAgICAgIC8vIFNob3J0IGNpcmN1aXQgaWYgdGhleSdyZSBub3QgdGhlIHNhbWUgbGVuZ3RoO1xuICAgICAgaWYgKGZpcnN0Lmxlbmd0aCAhPT0gc2Vjb25kLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpcnN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChzdHJpY3REZWVwRXF1YWwoZmlyc3RbaV0sIHNlY29uZFtpXSkgPT09IGZhbHNlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKGlzT2JqZWN0KGZpcnN0KSA9PT0gdHJ1ZSkge1xuICAgICAgLy8gQW4gb2JqZWN0IGlzIGVxdWFsIGlmIGl0IGhhcyB0aGUgc2FtZSBrZXkvdmFsdWUgcGFpcnMuXG4gICAgICB2YXIga2V5c1NlZW4gPSB7fTtcbiAgICAgIGZvciAodmFyIGtleSBpbiBmaXJzdCkge1xuICAgICAgICBpZiAoaGFzT3duUHJvcGVydHkuY2FsbChmaXJzdCwga2V5KSkge1xuICAgICAgICAgIGlmIChzdHJpY3REZWVwRXF1YWwoZmlyc3Rba2V5XSwgc2Vjb25kW2tleV0pID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBrZXlzU2VlbltrZXldID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gTm93IGNoZWNrIHRoYXQgdGhlcmUgYXJlbid0IGFueSBrZXlzIGluIHNlY29uZCB0aGF0IHdlcmVuJ3RcbiAgICAgIC8vIGluIGZpcnN0LlxuICAgICAgZm9yICh2YXIga2V5MiBpbiBzZWNvbmQpIHtcbiAgICAgICAgaWYgKGhhc093blByb3BlcnR5LmNhbGwoc2Vjb25kLCBrZXkyKSkge1xuICAgICAgICAgIGlmIChrZXlzU2VlbltrZXkyXSAhPT0gdHJ1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzRmFsc2Uob2JqKSB7XG4gICAgLy8gRnJvbSB0aGUgc3BlYzpcbiAgICAvLyBBIGZhbHNlIHZhbHVlIGNvcnJlc3BvbmRzIHRvIHRoZSBmb2xsb3dpbmcgdmFsdWVzOlxuICAgIC8vIEVtcHR5IGxpc3RcbiAgICAvLyBFbXB0eSBvYmplY3RcbiAgICAvLyBFbXB0eSBzdHJpbmdcbiAgICAvLyBGYWxzZSBib29sZWFuXG4gICAgLy8gbnVsbCB2YWx1ZVxuXG4gICAgLy8gRmlyc3QgY2hlY2sgdGhlIHNjYWxhciB2YWx1ZXMuXG4gICAgaWYgKG9iaiA9PT0gXCJcIiB8fCBvYmogPT09IGZhbHNlIHx8IG9iaiA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKGlzQXJyYXkob2JqKSAmJiBvYmoubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIENoZWNrIGZvciBhbiBlbXB0eSBhcnJheS5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIGlmIChpc09iamVjdChvYmopKSB7XG4gICAgICAgIC8vIENoZWNrIGZvciBhbiBlbXB0eSBvYmplY3QuXG4gICAgICAgIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkga2V5cywgdGhlblxuICAgICAgICAgICAgLy8gdGhlIG9iamVjdCBpcyBub3QgZW1wdHkgc28gdGhlIG9iamVjdFxuICAgICAgICAgICAgLy8gaXMgbm90IGZhbHNlLlxuICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gb2JqVmFsdWVzKG9iaikge1xuICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMob2JqKTtcbiAgICB2YXIgdmFsdWVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YWx1ZXMucHVzaChvYmpba2V5c1tpXV0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWVzO1xuICB9XG5cbiAgZnVuY3Rpb24gbWVyZ2UoYSwgYikge1xuICAgICAgdmFyIG1lcmdlZCA9IHt9O1xuICAgICAgZm9yICh2YXIga2V5IGluIGEpIHtcbiAgICAgICAgICBtZXJnZWRba2V5XSA9IGFba2V5XTtcbiAgICAgIH1cbiAgICAgIGZvciAodmFyIGtleTIgaW4gYikge1xuICAgICAgICAgIG1lcmdlZFtrZXkyXSA9IGJba2V5Ml07XG4gICAgICB9XG4gICAgICByZXR1cm4gbWVyZ2VkO1xuICB9XG5cbiAgdmFyIHRyaW1MZWZ0O1xuICBpZiAodHlwZW9mIFN0cmluZy5wcm90b3R5cGUudHJpbUxlZnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRyaW1MZWZ0ID0gZnVuY3Rpb24oc3RyKSB7XG4gICAgICByZXR1cm4gc3RyLnRyaW1MZWZ0KCk7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICB0cmltTGVmdCA9IGZ1bmN0aW9uKHN0cikge1xuICAgICAgcmV0dXJuIHN0ci5tYXRjaCgvXlxccyooLiopLylbMV07XG4gICAgfTtcbiAgfVxuXG4gIC8vIFR5cGUgY29uc3RhbnRzIHVzZWQgdG8gZGVmaW5lIGZ1bmN0aW9ucy5cbiAgdmFyIFRZUEVfTlVNQkVSID0gMDtcbiAgdmFyIFRZUEVfQU5ZID0gMTtcbiAgdmFyIFRZUEVfU1RSSU5HID0gMjtcbiAgdmFyIFRZUEVfQVJSQVkgPSAzO1xuICB2YXIgVFlQRV9PQkpFQ1QgPSA0O1xuICB2YXIgVFlQRV9CT09MRUFOID0gNTtcbiAgdmFyIFRZUEVfRVhQUkVGID0gNjtcbiAgdmFyIFRZUEVfTlVMTCA9IDc7XG4gIHZhciBUWVBFX0FSUkFZX05VTUJFUiA9IDg7XG4gIHZhciBUWVBFX0FSUkFZX1NUUklORyA9IDk7XG5cbiAgdmFyIFRPS19FT0YgPSBcIkVPRlwiO1xuICB2YXIgVE9LX1VOUVVPVEVESURFTlRJRklFUiA9IFwiVW5xdW90ZWRJZGVudGlmaWVyXCI7XG4gIHZhciBUT0tfUVVPVEVESURFTlRJRklFUiA9IFwiUXVvdGVkSWRlbnRpZmllclwiO1xuICB2YXIgVE9LX1JCUkFDS0VUID0gXCJSYnJhY2tldFwiO1xuICB2YXIgVE9LX1JQQVJFTiA9IFwiUnBhcmVuXCI7XG4gIHZhciBUT0tfQ09NTUEgPSBcIkNvbW1hXCI7XG4gIHZhciBUT0tfQ09MT04gPSBcIkNvbG9uXCI7XG4gIHZhciBUT0tfUkJSQUNFID0gXCJSYnJhY2VcIjtcbiAgdmFyIFRPS19OVU1CRVIgPSBcIk51bWJlclwiO1xuICB2YXIgVE9LX0NVUlJFTlQgPSBcIkN1cnJlbnRcIjtcbiAgdmFyIFRPS19FWFBSRUYgPSBcIkV4cHJlZlwiO1xuICB2YXIgVE9LX1BJUEUgPSBcIlBpcGVcIjtcbiAgdmFyIFRPS19PUiA9IFwiT3JcIjtcbiAgdmFyIFRPS19BTkQgPSBcIkFuZFwiO1xuICB2YXIgVE9LX0VRID0gXCJFUVwiO1xuICB2YXIgVE9LX0dUID0gXCJHVFwiO1xuICB2YXIgVE9LX0xUID0gXCJMVFwiO1xuICB2YXIgVE9LX0dURSA9IFwiR1RFXCI7XG4gIHZhciBUT0tfTFRFID0gXCJMVEVcIjtcbiAgdmFyIFRPS19ORSA9IFwiTkVcIjtcbiAgdmFyIFRPS19GTEFUVEVOID0gXCJGbGF0dGVuXCI7XG4gIHZhciBUT0tfU1RBUiA9IFwiU3RhclwiO1xuICB2YXIgVE9LX0ZJTFRFUiA9IFwiRmlsdGVyXCI7XG4gIHZhciBUT0tfRE9UID0gXCJEb3RcIjtcbiAgdmFyIFRPS19OT1QgPSBcIk5vdFwiO1xuICB2YXIgVE9LX0xCUkFDRSA9IFwiTGJyYWNlXCI7XG4gIHZhciBUT0tfTEJSQUNLRVQgPSBcIkxicmFja2V0XCI7XG4gIHZhciBUT0tfTFBBUkVOPSBcIkxwYXJlblwiO1xuICB2YXIgVE9LX0xJVEVSQUw9IFwiTGl0ZXJhbFwiO1xuXG4gIC8vIFRoZSBcIiZcIiwgXCJbXCIsIFwiPFwiLCBcIj5cIiB0b2tlbnNcbiAgLy8gYXJlIG5vdCBpbiBiYXNpY1Rva2VuIGJlY2F1c2VcbiAgLy8gdGhlcmUgYXJlIHR3byB0b2tlbiB2YXJpYW50c1xuICAvLyAoXCImJlwiLCBcIls/XCIsIFwiPD1cIiwgXCI+PVwiKS4gIFRoaXMgaXMgc3BlY2lhbGx5IGhhbmRsZWRcbiAgLy8gYmVsb3cuXG5cbiAgdmFyIGJhc2ljVG9rZW5zID0ge1xuICAgIFwiLlwiOiBUT0tfRE9ULFxuICAgIFwiKlwiOiBUT0tfU1RBUixcbiAgICBcIixcIjogVE9LX0NPTU1BLFxuICAgIFwiOlwiOiBUT0tfQ09MT04sXG4gICAgXCJ7XCI6IFRPS19MQlJBQ0UsXG4gICAgXCJ9XCI6IFRPS19SQlJBQ0UsXG4gICAgXCJdXCI6IFRPS19SQlJBQ0tFVCxcbiAgICBcIihcIjogVE9LX0xQQVJFTixcbiAgICBcIilcIjogVE9LX1JQQVJFTixcbiAgICBcIkBcIjogVE9LX0NVUlJFTlRcbiAgfTtcblxuICB2YXIgb3BlcmF0b3JTdGFydFRva2VuID0ge1xuICAgICAgXCI8XCI6IHRydWUsXG4gICAgICBcIj5cIjogdHJ1ZSxcbiAgICAgIFwiPVwiOiB0cnVlLFxuICAgICAgXCIhXCI6IHRydWVcbiAgfTtcblxuICB2YXIgc2tpcENoYXJzID0ge1xuICAgICAgXCIgXCI6IHRydWUsXG4gICAgICBcIlxcdFwiOiB0cnVlLFxuICAgICAgXCJcXG5cIjogdHJ1ZVxuICB9O1xuXG5cbiAgZnVuY3Rpb24gaXNBbHBoYShjaCkge1xuICAgICAgcmV0dXJuIChjaCA+PSBcImFcIiAmJiBjaCA8PSBcInpcIikgfHxcbiAgICAgICAgICAgICAoY2ggPj0gXCJBXCIgJiYgY2ggPD0gXCJaXCIpIHx8XG4gICAgICAgICAgICAgY2ggPT09IFwiX1wiO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNOdW0oY2gpIHtcbiAgICAgIHJldHVybiAoY2ggPj0gXCIwXCIgJiYgY2ggPD0gXCI5XCIpIHx8XG4gICAgICAgICAgICAgY2ggPT09IFwiLVwiO1xuICB9XG4gIGZ1bmN0aW9uIGlzQWxwaGFOdW0oY2gpIHtcbiAgICAgIHJldHVybiAoY2ggPj0gXCJhXCIgJiYgY2ggPD0gXCJ6XCIpIHx8XG4gICAgICAgICAgICAgKGNoID49IFwiQVwiICYmIGNoIDw9IFwiWlwiKSB8fFxuICAgICAgICAgICAgIChjaCA+PSBcIjBcIiAmJiBjaCA8PSBcIjlcIikgfHxcbiAgICAgICAgICAgICBjaCA9PT0gXCJfXCI7XG4gIH1cblxuICBmdW5jdGlvbiBMZXhlcigpIHtcbiAgfVxuICBMZXhlci5wcm90b3R5cGUgPSB7XG4gICAgICB0b2tlbml6ZTogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgdmFyIHRva2VucyA9IFtdO1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnQgPSAwO1xuICAgICAgICAgIHZhciBzdGFydDtcbiAgICAgICAgICB2YXIgaWRlbnRpZmllcjtcbiAgICAgICAgICB2YXIgdG9rZW47XG4gICAgICAgICAgd2hpbGUgKHRoaXMuX2N1cnJlbnQgPCBzdHJlYW0ubGVuZ3RoKSB7XG4gICAgICAgICAgICAgIGlmIChpc0FscGhhKHN0cmVhbVt0aGlzLl9jdXJyZW50XSkpIHtcbiAgICAgICAgICAgICAgICAgIHN0YXJ0ID0gdGhpcy5fY3VycmVudDtcbiAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXIgPSB0aGlzLl9jb25zdW1lVW5xdW90ZWRJZGVudGlmaWVyKHN0cmVhbSk7XG4gICAgICAgICAgICAgICAgICB0b2tlbnMucHVzaCh7dHlwZTogVE9LX1VOUVVPVEVESURFTlRJRklFUixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaWRlbnRpZmllcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGFydDogc3RhcnR9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChiYXNpY1Rva2Vuc1tzdHJlYW1bdGhpcy5fY3VycmVudF1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHt0eXBlOiBiYXNpY1Rva2Vuc1tzdHJlYW1bdGhpcy5fY3VycmVudF1dLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHN0cmVhbVt0aGlzLl9jdXJyZW50XSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXJ0OiB0aGlzLl9jdXJyZW50fSk7XG4gICAgICAgICAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNOdW0oc3RyZWFtW3RoaXMuX2N1cnJlbnRdKSkge1xuICAgICAgICAgICAgICAgICAgdG9rZW4gPSB0aGlzLl9jb25zdW1lTnVtYmVyKHN0cmVhbSk7XG4gICAgICAgICAgICAgICAgICB0b2tlbnMucHVzaCh0b2tlbik7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RyZWFtW3RoaXMuX2N1cnJlbnRdID09PSBcIltcIikge1xuICAgICAgICAgICAgICAgICAgLy8gTm8gbmVlZCB0byBpbmNyZW1lbnQgdGhpcy5fY3VycmVudC4gIFRoaXMgaGFwcGVuc1xuICAgICAgICAgICAgICAgICAgLy8gaW4gX2NvbnN1bWVMQnJhY2tldFxuICAgICAgICAgICAgICAgICAgdG9rZW4gPSB0aGlzLl9jb25zdW1lTEJyYWNrZXQoc3RyZWFtKTtcbiAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHRva2VuKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzdHJlYW1bdGhpcy5fY3VycmVudF0gPT09IFwiXFxcIlwiKSB7XG4gICAgICAgICAgICAgICAgICBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgICAgICAgICBpZGVudGlmaWVyID0gdGhpcy5fY29uc3VtZVF1b3RlZElkZW50aWZpZXIoc3RyZWFtKTtcbiAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHt0eXBlOiBUT0tfUVVPVEVESURFTlRJRklFUixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaWRlbnRpZmllcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGFydDogc3RhcnR9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzdHJlYW1bdGhpcy5fY3VycmVudF0gPT09IFwiJ1wiKSB7XG4gICAgICAgICAgICAgICAgICBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgICAgICAgICBpZGVudGlmaWVyID0gdGhpcy5fY29uc3VtZVJhd1N0cmluZ0xpdGVyYWwoc3RyZWFtKTtcbiAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHt0eXBlOiBUT0tfTElURVJBTCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogaWRlbnRpZmllcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGFydDogc3RhcnR9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChzdHJlYW1bdGhpcy5fY3VycmVudF0gPT09IFwiYFwiKSB7XG4gICAgICAgICAgICAgICAgICBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgICAgICAgICB2YXIgbGl0ZXJhbCA9IHRoaXMuX2NvbnN1bWVMaXRlcmFsKHN0cmVhbSk7XG4gICAgICAgICAgICAgICAgICB0b2tlbnMucHVzaCh7dHlwZTogVE9LX0xJVEVSQUwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGxpdGVyYWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhcnQ6IHN0YXJ0fSk7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAob3BlcmF0b3JTdGFydFRva2VuW3N0cmVhbVt0aGlzLl9jdXJyZW50XV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgdG9rZW5zLnB1c2godGhpcy5fY29uc3VtZU9wZXJhdG9yKHN0cmVhbSkpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNraXBDaGFyc1tzdHJlYW1bdGhpcy5fY3VycmVudF1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgIC8vIElnbm9yZSB3aGl0ZXNwYWNlLlxuICAgICAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHN0cmVhbVt0aGlzLl9jdXJyZW50XSA9PT0gXCImXCIpIHtcbiAgICAgICAgICAgICAgICAgIHN0YXJ0ID0gdGhpcy5fY3VycmVudDtcbiAgICAgICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICAgICAgICAgIGlmIChzdHJlYW1bdGhpcy5fY3VycmVudF0gPT09IFwiJlwiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHt0eXBlOiBUT0tfQU5ELCB2YWx1ZTogXCImJlwiLCBzdGFydDogc3RhcnR9KTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgdG9rZW5zLnB1c2goe3R5cGU6IFRPS19FWFBSRUYsIHZhbHVlOiBcIiZcIiwgc3RhcnQ6IHN0YXJ0fSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RyZWFtW3RoaXMuX2N1cnJlbnRdID09PSBcInxcIikge1xuICAgICAgICAgICAgICAgICAgc3RhcnQgPSB0aGlzLl9jdXJyZW50O1xuICAgICAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgICAgICAgICAgaWYgKHN0cmVhbVt0aGlzLl9jdXJyZW50XSA9PT0gXCJ8XCIpIHtcbiAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgICAgICAgICAgICAgdG9rZW5zLnB1c2goe3R5cGU6IFRPS19PUiwgdmFsdWU6IFwifHxcIiwgc3RhcnQ6IHN0YXJ0fSk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHt0eXBlOiBUT0tfUElQRSwgdmFsdWU6IFwifFwiLCBzdGFydDogc3RhcnR9KTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcihcIlVua25vd24gY2hhcmFjdGVyOlwiICsgc3RyZWFtW3RoaXMuX2N1cnJlbnRdKTtcbiAgICAgICAgICAgICAgICAgIGVycm9yLm5hbWUgPSBcIkxleGVyRXJyb3JcIjtcbiAgICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0b2tlbnM7XG4gICAgICB9LFxuXG4gICAgICBfY29uc3VtZVVucXVvdGVkSWRlbnRpZmllcjogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgdmFyIHN0YXJ0ID0gdGhpcy5fY3VycmVudDtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgd2hpbGUgKHRoaXMuX2N1cnJlbnQgPCBzdHJlYW0ubGVuZ3RoICYmIGlzQWxwaGFOdW0oc3RyZWFtW3RoaXMuX2N1cnJlbnRdKSkge1xuICAgICAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBzdHJlYW0uc2xpY2Uoc3RhcnQsIHRoaXMuX2N1cnJlbnQpO1xuICAgICAgfSxcblxuICAgICAgX2NvbnN1bWVRdW90ZWRJZGVudGlmaWVyOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICB2YXIgc3RhcnQgPSB0aGlzLl9jdXJyZW50O1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICB2YXIgbWF4TGVuZ3RoID0gc3RyZWFtLmxlbmd0aDtcbiAgICAgICAgICB3aGlsZSAoc3RyZWFtW3RoaXMuX2N1cnJlbnRdICE9PSBcIlxcXCJcIiAmJiB0aGlzLl9jdXJyZW50IDwgbWF4TGVuZ3RoKSB7XG4gICAgICAgICAgICAgIC8vIFlvdSBjYW4gZXNjYXBlIGEgZG91YmxlIHF1b3RlIGFuZCB5b3UgY2FuIGVzY2FwZSBhbiBlc2NhcGUuXG4gICAgICAgICAgICAgIHZhciBjdXJyZW50ID0gdGhpcy5fY3VycmVudDtcbiAgICAgICAgICAgICAgaWYgKHN0cmVhbVtjdXJyZW50XSA9PT0gXCJcXFxcXCIgJiYgKHN0cmVhbVtjdXJyZW50ICsgMV0gPT09IFwiXFxcXFwiIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0cmVhbVtjdXJyZW50ICsgMV0gPT09IFwiXFxcIlwiKSkge1xuICAgICAgICAgICAgICAgICAgY3VycmVudCArPSAyO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgY3VycmVudCsrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQgPSBjdXJyZW50O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RyZWFtLnNsaWNlKHN0YXJ0LCB0aGlzLl9jdXJyZW50KSk7XG4gICAgICB9LFxuXG4gICAgICBfY29uc3VtZVJhd1N0cmluZ0xpdGVyYWw6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIHZhciBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgIHZhciBtYXhMZW5ndGggPSBzdHJlYW0ubGVuZ3RoO1xuICAgICAgICAgIHdoaWxlIChzdHJlYW1bdGhpcy5fY3VycmVudF0gIT09IFwiJ1wiICYmIHRoaXMuX2N1cnJlbnQgPCBtYXhMZW5ndGgpIHtcbiAgICAgICAgICAgICAgLy8gWW91IGNhbiBlc2NhcGUgYSBzaW5nbGUgcXVvdGUgYW5kIHlvdSBjYW4gZXNjYXBlIGFuIGVzY2FwZS5cbiAgICAgICAgICAgICAgdmFyIGN1cnJlbnQgPSB0aGlzLl9jdXJyZW50O1xuICAgICAgICAgICAgICBpZiAoc3RyZWFtW2N1cnJlbnRdID09PSBcIlxcXFxcIiAmJiAoc3RyZWFtW2N1cnJlbnQgKyAxXSA9PT0gXCJcXFxcXCIgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RyZWFtW2N1cnJlbnQgKyAxXSA9PT0gXCInXCIpKSB7XG4gICAgICAgICAgICAgICAgICBjdXJyZW50ICs9IDI7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBjdXJyZW50Kys7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCA9IGN1cnJlbnQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICB2YXIgbGl0ZXJhbCA9IHN0cmVhbS5zbGljZShzdGFydCArIDEsIHRoaXMuX2N1cnJlbnQgLSAxKTtcbiAgICAgICAgICByZXR1cm4gbGl0ZXJhbC5yZXBsYWNlKFwiXFxcXCdcIiwgXCInXCIpO1xuICAgICAgfSxcblxuICAgICAgX2NvbnN1bWVOdW1iZXI6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIHZhciBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgIHZhciBtYXhMZW5ndGggPSBzdHJlYW0ubGVuZ3RoO1xuICAgICAgICAgIHdoaWxlIChpc051bShzdHJlYW1bdGhpcy5fY3VycmVudF0pICYmIHRoaXMuX2N1cnJlbnQgPCBtYXhMZW5ndGgpIHtcbiAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgIH1cbiAgICAgICAgICB2YXIgdmFsdWUgPSBwYXJzZUludChzdHJlYW0uc2xpY2Uoc3RhcnQsIHRoaXMuX2N1cnJlbnQpKTtcbiAgICAgICAgICByZXR1cm4ge3R5cGU6IFRPS19OVU1CRVIsIHZhbHVlOiB2YWx1ZSwgc3RhcnQ6IHN0YXJ0fTtcbiAgICAgIH0sXG5cbiAgICAgIF9jb25zdW1lTEJyYWNrZXQ6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIHZhciBzdGFydCA9IHRoaXMuX2N1cnJlbnQ7XG4gICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgIGlmIChzdHJlYW1bdGhpcy5fY3VycmVudF0gPT09IFwiP1wiKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfRklMVEVSLCB2YWx1ZTogXCJbP1wiLCBzdGFydDogc3RhcnR9O1xuICAgICAgICAgIH0gZWxzZSBpZiAoc3RyZWFtW3RoaXMuX2N1cnJlbnRdID09PSBcIl1cIikge1xuICAgICAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0ZMQVRURU4sIHZhbHVlOiBcIltdXCIsIHN0YXJ0OiBzdGFydH07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfTEJSQUNLRVQsIHZhbHVlOiBcIltcIiwgc3RhcnQ6IHN0YXJ0fTtcbiAgICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBfY29uc3VtZU9wZXJhdG9yOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICB2YXIgc3RhcnQgPSB0aGlzLl9jdXJyZW50O1xuICAgICAgICAgIHZhciBzdGFydGluZ0NoYXIgPSBzdHJlYW1bc3RhcnRdO1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICBpZiAoc3RhcnRpbmdDaGFyID09PSBcIiFcIikge1xuICAgICAgICAgICAgICBpZiAoc3RyZWFtW3RoaXMuX2N1cnJlbnRdID09PSBcIj1cIikge1xuICAgICAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfTkUsIHZhbHVlOiBcIiE9XCIsIHN0YXJ0OiBzdGFydH07XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfTk9ULCB2YWx1ZTogXCIhXCIsIHN0YXJ0OiBzdGFydH07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKHN0YXJ0aW5nQ2hhciA9PT0gXCI8XCIpIHtcbiAgICAgICAgICAgICAgaWYgKHN0cmVhbVt0aGlzLl9jdXJyZW50XSA9PT0gXCI9XCIpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0xURSwgdmFsdWU6IFwiPD1cIiwgc3RhcnQ6IHN0YXJ0fTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0xULCB2YWx1ZTogXCI8XCIsIHN0YXJ0OiBzdGFydH07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKHN0YXJ0aW5nQ2hhciA9PT0gXCI+XCIpIHtcbiAgICAgICAgICAgICAgaWYgKHN0cmVhbVt0aGlzLl9jdXJyZW50XSA9PT0gXCI9XCIpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0dURSwgdmFsdWU6IFwiPj1cIiwgc3RhcnQ6IHN0YXJ0fTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0dULCB2YWx1ZTogXCI+XCIsIHN0YXJ0OiBzdGFydH07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKHN0YXJ0aW5nQ2hhciA9PT0gXCI9XCIpIHtcbiAgICAgICAgICAgICAgaWYgKHN0cmVhbVt0aGlzLl9jdXJyZW50XSA9PT0gXCI9XCIpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuX2N1cnJlbnQrKztcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7dHlwZTogVE9LX0VRLCB2YWx1ZTogXCI9PVwiLCBzdGFydDogc3RhcnR9O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgX2NvbnN1bWVMaXRlcmFsOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Kys7XG4gICAgICAgICAgdmFyIHN0YXJ0ID0gdGhpcy5fY3VycmVudDtcbiAgICAgICAgICB2YXIgbWF4TGVuZ3RoID0gc3RyZWFtLmxlbmd0aDtcbiAgICAgICAgICB2YXIgbGl0ZXJhbDtcbiAgICAgICAgICB3aGlsZShzdHJlYW1bdGhpcy5fY3VycmVudF0gIT09IFwiYFwiICYmIHRoaXMuX2N1cnJlbnQgPCBtYXhMZW5ndGgpIHtcbiAgICAgICAgICAgICAgLy8gWW91IGNhbiBlc2NhcGUgYSBsaXRlcmFsIGNoYXIgb3IgeW91IGNhbiBlc2NhcGUgdGhlIGVzY2FwZS5cbiAgICAgICAgICAgICAgdmFyIGN1cnJlbnQgPSB0aGlzLl9jdXJyZW50O1xuICAgICAgICAgICAgICBpZiAoc3RyZWFtW2N1cnJlbnRdID09PSBcIlxcXFxcIiAmJiAoc3RyZWFtW2N1cnJlbnQgKyAxXSA9PT0gXCJcXFxcXCIgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RyZWFtW2N1cnJlbnQgKyAxXSA9PT0gXCJgXCIpKSB7XG4gICAgICAgICAgICAgICAgICBjdXJyZW50ICs9IDI7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBjdXJyZW50Kys7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdGhpcy5fY3VycmVudCA9IGN1cnJlbnQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhciBsaXRlcmFsU3RyaW5nID0gdHJpbUxlZnQoc3RyZWFtLnNsaWNlKHN0YXJ0LCB0aGlzLl9jdXJyZW50KSk7XG4gICAgICAgICAgbGl0ZXJhbFN0cmluZyA9IGxpdGVyYWxTdHJpbmcucmVwbGFjZShcIlxcXFxgXCIsIFwiYFwiKTtcbiAgICAgICAgICBpZiAodGhpcy5fbG9va3NMaWtlSlNPTihsaXRlcmFsU3RyaW5nKSkge1xuICAgICAgICAgICAgICBsaXRlcmFsID0gSlNPTi5wYXJzZShsaXRlcmFsU3RyaW5nKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBUcnkgdG8gSlNPTiBwYXJzZSBpdCBhcyBcIjxsaXRlcmFsPlwiXG4gICAgICAgICAgICAgIGxpdGVyYWwgPSBKU09OLnBhcnNlKFwiXFxcIlwiICsgbGl0ZXJhbFN0cmluZyArIFwiXFxcIlwiKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gKzEgZ2V0cyB1cyB0byB0aGUgZW5kaW5nIFwiYFwiLCArMSB0byBtb3ZlIG9uIHRvIHRoZSBuZXh0IGNoYXIuXG4gICAgICAgICAgdGhpcy5fY3VycmVudCsrO1xuICAgICAgICAgIHJldHVybiBsaXRlcmFsO1xuICAgICAgfSxcblxuICAgICAgX2xvb2tzTGlrZUpTT046IGZ1bmN0aW9uKGxpdGVyYWxTdHJpbmcpIHtcbiAgICAgICAgICB2YXIgc3RhcnRpbmdDaGFycyA9IFwiW3tcXFwiXCI7XG4gICAgICAgICAgdmFyIGpzb25MaXRlcmFscyA9IFtcInRydWVcIiwgXCJmYWxzZVwiLCBcIm51bGxcIl07XG4gICAgICAgICAgdmFyIG51bWJlckxvb2tpbmcgPSBcIi0wMTIzNDU2Nzg5XCI7XG5cbiAgICAgICAgICBpZiAobGl0ZXJhbFN0cmluZyA9PT0gXCJcIikge1xuICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfSBlbHNlIGlmIChzdGFydGluZ0NoYXJzLmluZGV4T2YobGl0ZXJhbFN0cmluZ1swXSkgPj0gMCkge1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGpzb25MaXRlcmFscy5pbmRleE9mKGxpdGVyYWxTdHJpbmcpID49IDApIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfSBlbHNlIGlmIChudW1iZXJMb29raW5nLmluZGV4T2YobGl0ZXJhbFN0cmluZ1swXSkgPj0gMCkge1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgSlNPTi5wYXJzZShsaXRlcmFsU3RyaW5nKTtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICB9IGNhdGNoIChleCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgIH1cbiAgfTtcblxuICAgICAgdmFyIGJpbmRpbmdQb3dlciA9IHt9O1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19FT0ZdID0gMDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfVU5RVU9URURJREVOVElGSUVSXSA9IDA7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX1FVT1RFRElERU5USUZJRVJdID0gMDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfUkJSQUNLRVRdID0gMDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfUlBBUkVOXSA9IDA7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX0NPTU1BXSA9IDA7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX1JCUkFDRV0gPSAwO1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19OVU1CRVJdID0gMDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfQ1VSUkVOVF0gPSAwO1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19FWFBSRUZdID0gMDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfUElQRV0gPSAxO1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19PUl0gPSAyO1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19BTkRdID0gMztcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfRVFdID0gNTtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfR1RdID0gNTtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfTFRdID0gNTtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfR1RFXSA9IDU7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX0xURV0gPSA1O1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19ORV0gPSA1O1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19GTEFUVEVOXSA9IDk7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX1NUQVJdID0gMjA7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX0ZJTFRFUl0gPSAyMTtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfRE9UXSA9IDQwO1xuICAgICAgYmluZGluZ1Bvd2VyW1RPS19OT1RdID0gNDU7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX0xCUkFDRV0gPSA1MDtcbiAgICAgIGJpbmRpbmdQb3dlcltUT0tfTEJSQUNLRVRdID0gNTU7XG4gICAgICBiaW5kaW5nUG93ZXJbVE9LX0xQQVJFTl0gPSA2MDtcblxuICBmdW5jdGlvbiBQYXJzZXIoKSB7XG4gIH1cblxuICBQYXJzZXIucHJvdG90eXBlID0ge1xuICAgICAgcGFyc2U6IGZ1bmN0aW9uKGV4cHJlc3Npb24pIHtcbiAgICAgICAgICB0aGlzLl9sb2FkVG9rZW5zKGV4cHJlc3Npb24pO1xuICAgICAgICAgIHRoaXMuaW5kZXggPSAwO1xuICAgICAgICAgIHZhciBhc3QgPSB0aGlzLmV4cHJlc3Npb24oMCk7XG4gICAgICAgICAgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSAhPT0gVE9LX0VPRikge1xuICAgICAgICAgICAgICB2YXIgdCA9IHRoaXMuX2xvb2thaGVhZFRva2VuKDApO1xuICAgICAgICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICBcIlVuZXhwZWN0ZWQgdG9rZW4gdHlwZTogXCIgKyB0LnR5cGUgKyBcIiwgdmFsdWU6IFwiICsgdC52YWx1ZSk7XG4gICAgICAgICAgICAgIGVycm9yLm5hbWUgPSBcIlBhcnNlckVycm9yXCI7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYXN0O1xuICAgICAgfSxcblxuICAgICAgX2xvYWRUb2tlbnM6IGZ1bmN0aW9uKGV4cHJlc3Npb24pIHtcbiAgICAgICAgICB2YXIgbGV4ZXIgPSBuZXcgTGV4ZXIoKTtcbiAgICAgICAgICB2YXIgdG9rZW5zID0gbGV4ZXIudG9rZW5pemUoZXhwcmVzc2lvbik7XG4gICAgICAgICAgdG9rZW5zLnB1c2goe3R5cGU6IFRPS19FT0YsIHZhbHVlOiBcIlwiLCBzdGFydDogZXhwcmVzc2lvbi5sZW5ndGh9KTtcbiAgICAgICAgICB0aGlzLnRva2VucyA9IHRva2VucztcbiAgICAgIH0sXG5cbiAgICAgIGV4cHJlc3Npb246IGZ1bmN0aW9uKHJicCkge1xuICAgICAgICAgIHZhciBsZWZ0VG9rZW4gPSB0aGlzLl9sb29rYWhlYWRUb2tlbigwKTtcbiAgICAgICAgICB0aGlzLl9hZHZhbmNlKCk7XG4gICAgICAgICAgdmFyIGxlZnQgPSB0aGlzLm51ZChsZWZ0VG9rZW4pO1xuICAgICAgICAgIHZhciBjdXJyZW50VG9rZW4gPSB0aGlzLl9sb29rYWhlYWQoMCk7XG4gICAgICAgICAgd2hpbGUgKHJicCA8IGJpbmRpbmdQb3dlcltjdXJyZW50VG9rZW5dKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgICAgICAgICAgbGVmdCA9IHRoaXMubGVkKGN1cnJlbnRUb2tlbiwgbGVmdCk7XG4gICAgICAgICAgICAgIGN1cnJlbnRUb2tlbiA9IHRoaXMuX2xvb2thaGVhZCgwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGxlZnQ7XG4gICAgICB9LFxuXG4gICAgICBfbG9va2FoZWFkOiBmdW5jdGlvbihudW1iZXIpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy50b2tlbnNbdGhpcy5pbmRleCArIG51bWJlcl0udHlwZTtcbiAgICAgIH0sXG5cbiAgICAgIF9sb29rYWhlYWRUb2tlbjogZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMudG9rZW5zW3RoaXMuaW5kZXggKyBudW1iZXJdO1xuICAgICAgfSxcblxuICAgICAgX2FkdmFuY2U6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuaW5kZXgrKztcbiAgICAgIH0sXG5cbiAgICAgIG51ZDogZnVuY3Rpb24odG9rZW4pIHtcbiAgICAgICAgdmFyIGxlZnQ7XG4gICAgICAgIHZhciByaWdodDtcbiAgICAgICAgdmFyIGV4cHJlc3Npb247XG4gICAgICAgIHN3aXRjaCAodG9rZW4udHlwZSkge1xuICAgICAgICAgIGNhc2UgVE9LX0xJVEVSQUw6XG4gICAgICAgICAgICByZXR1cm4ge3R5cGU6IFwiTGl0ZXJhbFwiLCB2YWx1ZTogdG9rZW4udmFsdWV9O1xuICAgICAgICAgIGNhc2UgVE9LX1VOUVVPVEVESURFTlRJRklFUjpcbiAgICAgICAgICAgIHJldHVybiB7dHlwZTogXCJGaWVsZFwiLCBuYW1lOiB0b2tlbi52YWx1ZX07XG4gICAgICAgICAgY2FzZSBUT0tfUVVPVEVESURFTlRJRklFUjpcbiAgICAgICAgICAgIHZhciBub2RlID0ge3R5cGU6IFwiRmllbGRcIiwgbmFtZTogdG9rZW4udmFsdWV9O1xuICAgICAgICAgICAgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSA9PT0gVE9LX0xQQVJFTikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlF1b3RlZCBpZGVudGlmaWVyIG5vdCBhbGxvd2VkIGZvciBmdW5jdGlvbiBuYW1lcy5cIik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSBUT0tfTk9UOlxuICAgICAgICAgICAgcmlnaHQgPSB0aGlzLmV4cHJlc3Npb24oYmluZGluZ1Bvd2VyLk5vdCk7XG4gICAgICAgICAgICByZXR1cm4ge3R5cGU6IFwiTm90RXhwcmVzc2lvblwiLCBjaGlsZHJlbjogW3JpZ2h0XX07XG4gICAgICAgICAgY2FzZSBUT0tfU1RBUjpcbiAgICAgICAgICAgIGxlZnQgPSB7dHlwZTogXCJJZGVudGl0eVwifTtcbiAgICAgICAgICAgIHJpZ2h0ID0gbnVsbDtcbiAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19SQlJBQ0tFVCkge1xuICAgICAgICAgICAgICAgIC8vIFRoaXMgY2FuIGhhcHBlbiBpbiBhIG11bHRpc2VsZWN0LFxuICAgICAgICAgICAgICAgIC8vIFthLCBiLCAqXVxuICAgICAgICAgICAgICAgIHJpZ2h0ID0ge3R5cGU6IFwiSWRlbnRpdHlcIn07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5fcGFyc2VQcm9qZWN0aW9uUkhTKGJpbmRpbmdQb3dlci5TdGFyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7dHlwZTogXCJWYWx1ZVByb2plY3Rpb25cIiwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgIGNhc2UgVE9LX0ZJTFRFUjpcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmxlZCh0b2tlbi50eXBlLCB7dHlwZTogXCJJZGVudGl0eVwifSk7XG4gICAgICAgICAgY2FzZSBUT0tfTEJSQUNFOlxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3BhcnNlTXVsdGlzZWxlY3RIYXNoKCk7XG4gICAgICAgICAgY2FzZSBUT0tfRkxBVFRFTjpcbiAgICAgICAgICAgIGxlZnQgPSB7dHlwZTogVE9LX0ZMQVRURU4sIGNoaWxkcmVuOiBbe3R5cGU6IFwiSWRlbnRpdHlcIn1dfTtcbiAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5fcGFyc2VQcm9qZWN0aW9uUkhTKGJpbmRpbmdQb3dlci5GbGF0dGVuKTtcbiAgICAgICAgICAgIHJldHVybiB7dHlwZTogXCJQcm9qZWN0aW9uXCIsIGNoaWxkcmVuOiBbbGVmdCwgcmlnaHRdfTtcbiAgICAgICAgICBjYXNlIFRPS19MQlJBQ0tFVDpcbiAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19OVU1CRVIgfHwgdGhpcy5fbG9va2FoZWFkKDApID09PSBUT0tfQ09MT04pIHtcbiAgICAgICAgICAgICAgICByaWdodCA9IHRoaXMuX3BhcnNlSW5kZXhFeHByZXNzaW9uKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3Byb2plY3RJZlNsaWNlKHt0eXBlOiBcIklkZW50aXR5XCJ9LCByaWdodCk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSA9PT0gVE9LX1NUQVIgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fbG9va2FoZWFkKDEpID09PSBUT0tfUkJSQUNLRVQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9hZHZhbmNlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fYWR2YW5jZSgpO1xuICAgICAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5fcGFyc2VQcm9qZWN0aW9uUkhTKGJpbmRpbmdQb3dlci5TdGFyKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge3R5cGU6IFwiUHJvamVjdGlvblwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IFt7dHlwZTogXCJJZGVudGl0eVwifSwgcmlnaHRdfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3BhcnNlTXVsdGlzZWxlY3RMaXN0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIFRPS19DVVJSRU5UOlxuICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfQ1VSUkVOVH07XG4gICAgICAgICAgY2FzZSBUT0tfRVhQUkVGOlxuICAgICAgICAgICAgZXhwcmVzc2lvbiA9IHRoaXMuZXhwcmVzc2lvbihiaW5kaW5nUG93ZXIuRXhwcmVmKTtcbiAgICAgICAgICAgIHJldHVybiB7dHlwZTogXCJFeHByZXNzaW9uUmVmZXJlbmNlXCIsIGNoaWxkcmVuOiBbZXhwcmVzc2lvbl19O1xuICAgICAgICAgIGNhc2UgVE9LX0xQQVJFTjpcbiAgICAgICAgICAgIHZhciBhcmdzID0gW107XG4gICAgICAgICAgICB3aGlsZSAodGhpcy5fbG9va2FoZWFkKDApICE9PSBUT0tfUlBBUkVOKSB7XG4gICAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19DVVJSRU5UKSB7XG4gICAgICAgICAgICAgICAgZXhwcmVzc2lvbiA9IHt0eXBlOiBUT0tfQ1VSUkVOVH07XG4gICAgICAgICAgICAgICAgdGhpcy5fYWR2YW5jZSgpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cHJlc3Npb24gPSB0aGlzLmV4cHJlc3Npb24oMCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYXJncy5wdXNoKGV4cHJlc3Npb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWF0Y2goVE9LX1JQQVJFTik7XG4gICAgICAgICAgICByZXR1cm4gYXJnc1swXTtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGhpcy5fZXJyb3JUb2tlbih0b2tlbik7XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGxlZDogZnVuY3Rpb24odG9rZW5OYW1lLCBsZWZ0KSB7XG4gICAgICAgIHZhciByaWdodDtcbiAgICAgICAgc3dpdGNoKHRva2VuTmFtZSkge1xuICAgICAgICAgIGNhc2UgVE9LX0RPVDpcbiAgICAgICAgICAgIHZhciByYnAgPSBiaW5kaW5nUG93ZXIuRG90O1xuICAgICAgICAgICAgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSAhPT0gVE9LX1NUQVIpIHtcbiAgICAgICAgICAgICAgICByaWdodCA9IHRoaXMuX3BhcnNlRG90UkhTKHJicCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBcIlN1YmV4cHJlc3Npb25cIiwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBDcmVhdGluZyBhIHByb2plY3Rpb24uXG4gICAgICAgICAgICAgICAgdGhpcy5fYWR2YW5jZSgpO1xuICAgICAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5fcGFyc2VQcm9qZWN0aW9uUkhTKHJicCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBcIlZhbHVlUHJvamVjdGlvblwiLCBjaGlsZHJlbjogW2xlZnQsIHJpZ2h0XX07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlIFRPS19QSVBFOlxuICAgICAgICAgICAgcmlnaHQgPSB0aGlzLmV4cHJlc3Npb24oYmluZGluZ1Bvd2VyLlBpcGUpO1xuICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBUT0tfUElQRSwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgIGNhc2UgVE9LX09SOlxuICAgICAgICAgICAgcmlnaHQgPSB0aGlzLmV4cHJlc3Npb24oYmluZGluZ1Bvd2VyLk9yKTtcbiAgICAgICAgICAgIHJldHVybiB7dHlwZTogXCJPckV4cHJlc3Npb25cIiwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgIGNhc2UgVE9LX0FORDpcbiAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5leHByZXNzaW9uKGJpbmRpbmdQb3dlci5BbmQpO1xuICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBcIkFuZEV4cHJlc3Npb25cIiwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgIGNhc2UgVE9LX0xQQVJFTjpcbiAgICAgICAgICAgIHZhciBuYW1lID0gbGVmdC5uYW1lO1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBbXTtcbiAgICAgICAgICAgIHZhciBleHByZXNzaW9uLCBub2RlO1xuICAgICAgICAgICAgd2hpbGUgKHRoaXMuX2xvb2thaGVhZCgwKSAhPT0gVE9LX1JQQVJFTikge1xuICAgICAgICAgICAgICBpZiAodGhpcy5fbG9va2FoZWFkKDApID09PSBUT0tfQ1VSUkVOVCkge1xuICAgICAgICAgICAgICAgIGV4cHJlc3Npb24gPSB7dHlwZTogVE9LX0NVUlJFTlR9O1xuICAgICAgICAgICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBleHByZXNzaW9uID0gdGhpcy5leHByZXNzaW9uKDApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19DT01NQSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19DT01NQSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYXJncy5wdXNoKGV4cHJlc3Npb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWF0Y2goVE9LX1JQQVJFTik7XG4gICAgICAgICAgICBub2RlID0ge3R5cGU6IFwiRnVuY3Rpb25cIiwgbmFtZTogbmFtZSwgY2hpbGRyZW46IGFyZ3N9O1xuICAgICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgICAgY2FzZSBUT0tfRklMVEVSOlxuICAgICAgICAgICAgdmFyIGNvbmRpdGlvbiA9IHRoaXMuZXhwcmVzc2lvbigwKTtcbiAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19SQlJBQ0tFVCk7XG4gICAgICAgICAgICBpZiAodGhpcy5fbG9va2FoZWFkKDApID09PSBUT0tfRkxBVFRFTikge1xuICAgICAgICAgICAgICByaWdodCA9IHt0eXBlOiBcIklkZW50aXR5XCJ9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmlnaHQgPSB0aGlzLl9wYXJzZVByb2plY3Rpb25SSFMoYmluZGluZ1Bvd2VyLkZpbHRlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge3R5cGU6IFwiRmlsdGVyUHJvamVjdGlvblwiLCBjaGlsZHJlbjogW2xlZnQsIHJpZ2h0LCBjb25kaXRpb25dfTtcbiAgICAgICAgICBjYXNlIFRPS19GTEFUVEVOOlxuICAgICAgICAgICAgdmFyIGxlZnROb2RlID0ge3R5cGU6IFRPS19GTEFUVEVOLCBjaGlsZHJlbjogW2xlZnRdfTtcbiAgICAgICAgICAgIHZhciByaWdodE5vZGUgPSB0aGlzLl9wYXJzZVByb2plY3Rpb25SSFMoYmluZGluZ1Bvd2VyLkZsYXR0ZW4pO1xuICAgICAgICAgICAgcmV0dXJuIHt0eXBlOiBcIlByb2plY3Rpb25cIiwgY2hpbGRyZW46IFtsZWZ0Tm9kZSwgcmlnaHROb2RlXX07XG4gICAgICAgICAgY2FzZSBUT0tfRVE6XG4gICAgICAgICAgY2FzZSBUT0tfTkU6XG4gICAgICAgICAgY2FzZSBUT0tfR1Q6XG4gICAgICAgICAgY2FzZSBUT0tfR1RFOlxuICAgICAgICAgIGNhc2UgVE9LX0xUOlxuICAgICAgICAgIGNhc2UgVE9LX0xURTpcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9wYXJzZUNvbXBhcmF0b3IobGVmdCwgdG9rZW5OYW1lKTtcbiAgICAgICAgICBjYXNlIFRPS19MQlJBQ0tFVDpcbiAgICAgICAgICAgIHZhciB0b2tlbiA9IHRoaXMuX2xvb2thaGVhZFRva2VuKDApO1xuICAgICAgICAgICAgaWYgKHRva2VuLnR5cGUgPT09IFRPS19OVU1CRVIgfHwgdG9rZW4udHlwZSA9PT0gVE9LX0NPTE9OKSB7XG4gICAgICAgICAgICAgICAgcmlnaHQgPSB0aGlzLl9wYXJzZUluZGV4RXhwcmVzc2lvbigpO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9wcm9qZWN0SWZTbGljZShsZWZ0LCByaWdodCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19TVEFSKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9tYXRjaChUT0tfUkJSQUNLRVQpO1xuICAgICAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5fcGFyc2VQcm9qZWN0aW9uUkhTKGJpbmRpbmdQb3dlci5TdGFyKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge3R5cGU6IFwiUHJvamVjdGlvblwiLCBjaGlsZHJlbjogW2xlZnQsIHJpZ2h0XX07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGhpcy5fZXJyb3JUb2tlbih0aGlzLl9sb29rYWhlYWRUb2tlbigwKSk7XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIF9tYXRjaDogZnVuY3Rpb24odG9rZW5UeXBlKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSA9PT0gdG9rZW5UeXBlKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB2YXIgdCA9IHRoaXMuX2xvb2thaGVhZFRva2VuKDApO1xuICAgICAgICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoXCJFeHBlY3RlZCBcIiArIHRva2VuVHlwZSArIFwiLCBnb3Q6IFwiICsgdC50eXBlKTtcbiAgICAgICAgICAgICAgZXJyb3IubmFtZSA9IFwiUGFyc2VyRXJyb3JcIjtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgX2Vycm9yVG9rZW46IGZ1bmN0aW9uKHRva2VuKSB7XG4gICAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKFwiSW52YWxpZCB0b2tlbiAoXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b2tlbi50eXBlICsgXCIpOiBcXFwiXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b2tlbi52YWx1ZSArIFwiXFxcIlwiKTtcbiAgICAgICAgICBlcnJvci5uYW1lID0gXCJQYXJzZXJFcnJvclwiO1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSxcblxuXG4gICAgICBfcGFyc2VJbmRleEV4cHJlc3Npb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19DT0xPTiB8fCB0aGlzLl9sb29rYWhlYWQoMSkgPT09IFRPS19DT0xPTikge1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fcGFyc2VTbGljZUV4cHJlc3Npb24oKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB2YXIgbm9kZSA9IHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6IFwiSW5kZXhcIixcbiAgICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLl9sb29rYWhlYWRUb2tlbigwKS52YWx1ZX07XG4gICAgICAgICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgICAgICAgICAgdGhpcy5fbWF0Y2goVE9LX1JCUkFDS0VUKTtcbiAgICAgICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgX3Byb2plY3RJZlNsaWNlOiBmdW5jdGlvbihsZWZ0LCByaWdodCkge1xuICAgICAgICAgIHZhciBpbmRleEV4cHIgPSB7dHlwZTogXCJJbmRleEV4cHJlc3Npb25cIiwgY2hpbGRyZW46IFtsZWZ0LCByaWdodF19O1xuICAgICAgICAgIGlmIChyaWdodC50eXBlID09PSBcIlNsaWNlXCIpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6IFwiUHJvamVjdGlvblwiLFxuICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IFtpbmRleEV4cHIsIHRoaXMuX3BhcnNlUHJvamVjdGlvblJIUyhiaW5kaW5nUG93ZXIuU3RhcildXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGluZGV4RXhwcjtcbiAgICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBfcGFyc2VTbGljZUV4cHJlc3Npb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIC8vIFtzdGFydDplbmQ6c3RlcF0gd2hlcmUgZWFjaCBwYXJ0IGlzIG9wdGlvbmFsLCBhcyB3ZWxsIGFzIHRoZSBsYXN0XG4gICAgICAgICAgLy8gY29sb24uXG4gICAgICAgICAgdmFyIHBhcnRzID0gW251bGwsIG51bGwsIG51bGxdO1xuICAgICAgICAgIHZhciBpbmRleCA9IDA7XG4gICAgICAgICAgdmFyIGN1cnJlbnRUb2tlbiA9IHRoaXMuX2xvb2thaGVhZCgwKTtcbiAgICAgICAgICB3aGlsZSAoY3VycmVudFRva2VuICE9PSBUT0tfUkJSQUNLRVQgJiYgaW5kZXggPCAzKSB7XG4gICAgICAgICAgICAgIGlmIChjdXJyZW50VG9rZW4gPT09IFRPS19DT0xPTikge1xuICAgICAgICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgICAgICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50VG9rZW4gPT09IFRPS19OVU1CRVIpIHtcbiAgICAgICAgICAgICAgICAgIHBhcnRzW2luZGV4XSA9IHRoaXMuX2xvb2thaGVhZFRva2VuKDApLnZhbHVlO1xuICAgICAgICAgICAgICAgICAgdGhpcy5fYWR2YW5jZSgpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgdmFyIHQgPSB0aGlzLl9sb29rYWhlYWQoMCk7XG4gICAgICAgICAgICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoXCJTeW50YXggZXJyb3IsIHVuZXhwZWN0ZWQgdG9rZW46IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0LnZhbHVlICsgXCIoXCIgKyB0LnR5cGUgKyBcIilcIik7XG4gICAgICAgICAgICAgICAgICBlcnJvci5uYW1lID0gXCJQYXJzZXJlcnJvclwiO1xuICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY3VycmVudFRva2VuID0gdGhpcy5fbG9va2FoZWFkKDApO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9tYXRjaChUT0tfUkJSQUNLRVQpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIHR5cGU6IFwiU2xpY2VcIixcbiAgICAgICAgICAgICAgY2hpbGRyZW46IHBhcnRzXG4gICAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIF9wYXJzZUNvbXBhcmF0b3I6IGZ1bmN0aW9uKGxlZnQsIGNvbXBhcmF0b3IpIHtcbiAgICAgICAgdmFyIHJpZ2h0ID0gdGhpcy5leHByZXNzaW9uKGJpbmRpbmdQb3dlcltjb21wYXJhdG9yXSk7XG4gICAgICAgIHJldHVybiB7dHlwZTogXCJDb21wYXJhdG9yXCIsIG5hbWU6IGNvbXBhcmF0b3IsIGNoaWxkcmVuOiBbbGVmdCwgcmlnaHRdfTtcbiAgICAgIH0sXG5cbiAgICAgIF9wYXJzZURvdFJIUzogZnVuY3Rpb24ocmJwKSB7XG4gICAgICAgICAgdmFyIGxvb2thaGVhZCA9IHRoaXMuX2xvb2thaGVhZCgwKTtcbiAgICAgICAgICB2YXIgZXhwclRva2VucyA9IFtUT0tfVU5RVU9URURJREVOVElGSUVSLCBUT0tfUVVPVEVESURFTlRJRklFUiwgVE9LX1NUQVJdO1xuICAgICAgICAgIGlmIChleHByVG9rZW5zLmluZGV4T2YobG9va2FoZWFkKSA+PSAwKSB7XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmV4cHJlc3Npb24ocmJwKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGxvb2thaGVhZCA9PT0gVE9LX0xCUkFDS0VUKSB7XG4gICAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19MQlJBQ0tFVCk7XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLl9wYXJzZU11bHRpc2VsZWN0TGlzdCgpO1xuICAgICAgICAgIH0gZWxzZSBpZiAobG9va2FoZWFkID09PSBUT0tfTEJSQUNFKSB7XG4gICAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19MQlJBQ0UpO1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fcGFyc2VNdWx0aXNlbGVjdEhhc2goKTtcbiAgICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBfcGFyc2VQcm9qZWN0aW9uUkhTOiBmdW5jdGlvbihyYnApIHtcbiAgICAgICAgICB2YXIgcmlnaHQ7XG4gICAgICAgICAgaWYgKGJpbmRpbmdQb3dlclt0aGlzLl9sb29rYWhlYWQoMCldIDwgMTApIHtcbiAgICAgICAgICAgICAgcmlnaHQgPSB7dHlwZTogXCJJZGVudGl0eVwifTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSA9PT0gVE9LX0xCUkFDS0VUKSB7XG4gICAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5leHByZXNzaW9uKHJicCk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19GSUxURVIpIHtcbiAgICAgICAgICAgICAgcmlnaHQgPSB0aGlzLmV4cHJlc3Npb24ocmJwKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2xvb2thaGVhZCgwKSA9PT0gVE9LX0RPVCkge1xuICAgICAgICAgICAgICB0aGlzLl9tYXRjaChUT0tfRE9UKTtcbiAgICAgICAgICAgICAgcmlnaHQgPSB0aGlzLl9wYXJzZURvdFJIUyhyYnApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHZhciB0ID0gdGhpcy5fbG9va2FoZWFkVG9rZW4oMCk7XG4gICAgICAgICAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcihcIlN5dGFueCBlcnJvciwgdW5leHBlY3RlZCB0b2tlbjogXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdC52YWx1ZSArIFwiKFwiICsgdC50eXBlICsgXCIpXCIpO1xuICAgICAgICAgICAgICBlcnJvci5uYW1lID0gXCJQYXJzZXJFcnJvclwiO1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHJpZ2h0O1xuICAgICAgfSxcblxuICAgICAgX3BhcnNlTXVsdGlzZWxlY3RMaXN0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgZXhwcmVzc2lvbnMgPSBbXTtcbiAgICAgICAgICB3aGlsZSAodGhpcy5fbG9va2FoZWFkKDApICE9PSBUT0tfUkJSQUNLRVQpIHtcbiAgICAgICAgICAgICAgdmFyIGV4cHJlc3Npb24gPSB0aGlzLmV4cHJlc3Npb24oMCk7XG4gICAgICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2goZXhwcmVzc2lvbik7XG4gICAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19DT01NQSkge1xuICAgICAgICAgICAgICAgICAgdGhpcy5fbWF0Y2goVE9LX0NPTU1BKTtcbiAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19SQlJBQ0tFVCkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIHRva2VuIFJicmFja2V0XCIpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19SQlJBQ0tFVCk7XG4gICAgICAgICAgcmV0dXJuIHt0eXBlOiBcIk11bHRpU2VsZWN0TGlzdFwiLCBjaGlsZHJlbjogZXhwcmVzc2lvbnN9O1xuICAgICAgfSxcblxuICAgICAgX3BhcnNlTXVsdGlzZWxlY3RIYXNoOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBhaXJzID0gW107XG4gICAgICAgIHZhciBpZGVudGlmaWVyVHlwZXMgPSBbVE9LX1VOUVVPVEVESURFTlRJRklFUiwgVE9LX1FVT1RFRElERU5USUZJRVJdO1xuICAgICAgICB2YXIga2V5VG9rZW4sIGtleU5hbWUsIHZhbHVlLCBub2RlO1xuICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAga2V5VG9rZW4gPSB0aGlzLl9sb29rYWhlYWRUb2tlbigwKTtcbiAgICAgICAgICBpZiAoaWRlbnRpZmllclR5cGVzLmluZGV4T2Yoa2V5VG9rZW4udHlwZSkgPCAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RpbmcgYW4gaWRlbnRpZmllciB0b2tlbiwgZ290OiBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAga2V5VG9rZW4udHlwZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGtleU5hbWUgPSBrZXlUb2tlbi52YWx1ZTtcbiAgICAgICAgICB0aGlzLl9hZHZhbmNlKCk7XG4gICAgICAgICAgdGhpcy5fbWF0Y2goVE9LX0NPTE9OKTtcbiAgICAgICAgICB2YWx1ZSA9IHRoaXMuZXhwcmVzc2lvbigwKTtcbiAgICAgICAgICBub2RlID0ge3R5cGU6IFwiS2V5VmFsdWVQYWlyXCIsIG5hbWU6IGtleU5hbWUsIHZhbHVlOiB2YWx1ZX07XG4gICAgICAgICAgcGFpcnMucHVzaChub2RlKTtcbiAgICAgICAgICBpZiAodGhpcy5fbG9va2FoZWFkKDApID09PSBUT0tfQ09NTUEpIHtcbiAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19DT01NQSk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9sb29rYWhlYWQoMCkgPT09IFRPS19SQlJBQ0UpIHtcbiAgICAgICAgICAgIHRoaXMuX21hdGNoKFRPS19SQlJBQ0UpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7dHlwZTogXCJNdWx0aVNlbGVjdEhhc2hcIiwgY2hpbGRyZW46IHBhaXJzfTtcbiAgICAgIH1cbiAgfTtcblxuXG4gIGZ1bmN0aW9uIFRyZWVJbnRlcnByZXRlcihydW50aW1lKSB7XG4gICAgdGhpcy5ydW50aW1lID0gcnVudGltZTtcbiAgfVxuXG4gIFRyZWVJbnRlcnByZXRlci5wcm90b3R5cGUgPSB7XG4gICAgICBzZWFyY2g6IGZ1bmN0aW9uKG5vZGUsIHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMudmlzaXQobm9kZSwgdmFsdWUpO1xuICAgICAgfSxcblxuICAgICAgdmlzaXQ6IGZ1bmN0aW9uKG5vZGUsIHZhbHVlKSB7XG4gICAgICAgICAgdmFyIG1hdGNoZWQsIGN1cnJlbnQsIHJlc3VsdCwgZmlyc3QsIHNlY29uZCwgZmllbGQsIGxlZnQsIHJpZ2h0LCBjb2xsZWN0ZWQsIGk7XG4gICAgICAgICAgc3dpdGNoIChub2RlLnR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgXCJGaWVsZFwiOlxuICAgICAgICAgICAgICBpZiAodmFsdWUgPT09IG51bGwgKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgIGZpZWxkID0gdmFsdWVbbm9kZS5uYW1lXTtcbiAgICAgICAgICAgICAgICAgIGlmIChmaWVsZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmaWVsZDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgXCJTdWJleHByZXNzaW9uXCI6XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHRoaXMudmlzaXQobm9kZS5jaGlsZHJlblswXSwgdmFsdWUpO1xuICAgICAgICAgICAgICBmb3IgKGkgPSAxOyBpIDwgbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCByZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICBjYXNlIFwiSW5kZXhFeHByZXNzaW9uXCI6XG4gICAgICAgICAgICAgIGxlZnQgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMF0sIHZhbHVlKTtcbiAgICAgICAgICAgICAgcmlnaHQgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMV0sIGxlZnQpO1xuICAgICAgICAgICAgICByZXR1cm4gcmlnaHQ7XG4gICAgICAgICAgICBjYXNlIFwiSW5kZXhcIjpcbiAgICAgICAgICAgICAgaWYgKCFpc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHZhciBpbmRleCA9IG5vZGUudmFsdWU7XG4gICAgICAgICAgICAgIGlmIChpbmRleCA8IDApIHtcbiAgICAgICAgICAgICAgICBpbmRleCA9IHZhbHVlLmxlbmd0aCArIGluZGV4O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHZhbHVlW2luZGV4XTtcbiAgICAgICAgICAgICAgaWYgKHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgY2FzZSBcIlNsaWNlXCI6XG4gICAgICAgICAgICAgIGlmICghaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB2YXIgc2xpY2VQYXJhbXMgPSBub2RlLmNoaWxkcmVuLnNsaWNlKDApO1xuICAgICAgICAgICAgICB2YXIgY29tcHV0ZWQgPSB0aGlzLmNvbXB1dGVTbGljZVBhcmFtcyh2YWx1ZS5sZW5ndGgsIHNsaWNlUGFyYW1zKTtcbiAgICAgICAgICAgICAgdmFyIHN0YXJ0ID0gY29tcHV0ZWRbMF07XG4gICAgICAgICAgICAgIHZhciBzdG9wID0gY29tcHV0ZWRbMV07XG4gICAgICAgICAgICAgIHZhciBzdGVwID0gY29tcHV0ZWRbMl07XG4gICAgICAgICAgICAgIHJlc3VsdCA9IFtdO1xuICAgICAgICAgICAgICBpZiAoc3RlcCA+IDApIHtcbiAgICAgICAgICAgICAgICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgc3RvcDsgaSArPSBzdGVwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2godmFsdWVbaV0pO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgZm9yIChpID0gc3RhcnQ7IGkgPiBzdG9wOyBpICs9IHN0ZXApIHtcbiAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucHVzaCh2YWx1ZVtpXSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIGNhc2UgXCJQcm9qZWN0aW9uXCI6XG4gICAgICAgICAgICAgIC8vIEV2YWx1YXRlIGxlZnQgY2hpbGQuXG4gICAgICAgICAgICAgIHZhciBiYXNlID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzBdLCB2YWx1ZSk7XG4gICAgICAgICAgICAgIGlmICghaXNBcnJheShiYXNlKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbGxlY3RlZCA9IFtdO1xuICAgICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgYmFzZS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMV0sIGJhc2VbaV0pO1xuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICBjb2xsZWN0ZWQucHVzaChjdXJyZW50KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIGNvbGxlY3RlZDtcbiAgICAgICAgICAgIGNhc2UgXCJWYWx1ZVByb2plY3Rpb25cIjpcbiAgICAgICAgICAgICAgLy8gRXZhbHVhdGUgbGVmdCBjaGlsZC5cbiAgICAgICAgICAgICAgYmFzZSA9IHRoaXMudmlzaXQobm9kZS5jaGlsZHJlblswXSwgdmFsdWUpO1xuICAgICAgICAgICAgICBpZiAoIWlzT2JqZWN0KGJhc2UpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29sbGVjdGVkID0gW107XG4gICAgICAgICAgICAgIHZhciB2YWx1ZXMgPSBvYmpWYWx1ZXMoYmFzZSk7XG4gICAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCB2YWx1ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50ID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCB2YWx1ZXNbaV0pO1xuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICBjb2xsZWN0ZWQucHVzaChjdXJyZW50KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIGNvbGxlY3RlZDtcbiAgICAgICAgICAgIGNhc2UgXCJGaWx0ZXJQcm9qZWN0aW9uXCI6XG4gICAgICAgICAgICAgIGJhc2UgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMF0sIHZhbHVlKTtcbiAgICAgICAgICAgICAgaWYgKCFpc0FycmF5KGJhc2UpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdmFyIGZpbHRlcmVkID0gW107XG4gICAgICAgICAgICAgIHZhciBmaW5hbFJlc3VsdHMgPSBbXTtcbiAgICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IGJhc2UubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBtYXRjaGVkID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzJdLCBiYXNlW2ldKTtcbiAgICAgICAgICAgICAgICBpZiAoIWlzRmFsc2UobWF0Y2hlZCkpIHtcbiAgICAgICAgICAgICAgICAgIGZpbHRlcmVkLnB1c2goYmFzZVtpXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZmlsdGVyZWQubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50ID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCBmaWx0ZXJlZFtqXSk7XG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgIGZpbmFsUmVzdWx0cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gZmluYWxSZXN1bHRzO1xuICAgICAgICAgICAgY2FzZSBcIkNvbXBhcmF0b3JcIjpcbiAgICAgICAgICAgICAgZmlyc3QgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMF0sIHZhbHVlKTtcbiAgICAgICAgICAgICAgc2Vjb25kID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCB2YWx1ZSk7XG4gICAgICAgICAgICAgIHN3aXRjaChub2RlLm5hbWUpIHtcbiAgICAgICAgICAgICAgICBjYXNlIFRPS19FUTpcbiAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IHN0cmljdERlZXBFcXVhbChmaXJzdCwgc2Vjb25kKTtcbiAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgVE9LX05FOlxuICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gIXN0cmljdERlZXBFcXVhbChmaXJzdCwgc2Vjb25kKTtcbiAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgVE9LX0dUOlxuICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gZmlyc3QgPiBzZWNvbmQ7XG4gICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIFRPS19HVEU6XG4gICAgICAgICAgICAgICAgICByZXN1bHQgPSBmaXJzdCA+PSBzZWNvbmQ7XG4gICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIFRPS19MVDpcbiAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGZpcnN0IDwgc2Vjb25kO1xuICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSBUT0tfTFRFOlxuICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gZmlyc3QgPD0gc2Vjb25kO1xuICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gY29tcGFyYXRvcjogXCIgKyBub2RlLm5hbWUpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICBjYXNlIFRPS19GTEFUVEVOOlxuICAgICAgICAgICAgICB2YXIgb3JpZ2luYWwgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMF0sIHZhbHVlKTtcbiAgICAgICAgICAgICAgaWYgKCFpc0FycmF5KG9yaWdpbmFsKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHZhciBtZXJnZWQgPSBbXTtcbiAgICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IG9yaWdpbmFsLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudCA9IG9yaWdpbmFsW2ldO1xuICAgICAgICAgICAgICAgIGlmIChpc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgICAgICAgICAgICAgICBtZXJnZWQucHVzaC5hcHBseShtZXJnZWQsIGN1cnJlbnQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBtZXJnZWQucHVzaChjdXJyZW50KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIG1lcmdlZDtcbiAgICAgICAgICAgIGNhc2UgXCJJZGVudGl0eVwiOlxuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICBjYXNlIFwiTXVsdGlTZWxlY3RMaXN0XCI6XG4gICAgICAgICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbGxlY3RlZCA9IFtdO1xuICAgICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgY29sbGVjdGVkLnB1c2godGhpcy52aXNpdChub2RlLmNoaWxkcmVuW2ldLCB2YWx1ZSkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBjb2xsZWN0ZWQ7XG4gICAgICAgICAgICBjYXNlIFwiTXVsdGlTZWxlY3RIYXNoXCI6XG4gICAgICAgICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbGxlY3RlZCA9IHt9O1xuICAgICAgICAgICAgICB2YXIgY2hpbGQ7XG4gICAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNvbGxlY3RlZFtjaGlsZC5uYW1lXSA9IHRoaXMudmlzaXQoY2hpbGQudmFsdWUsIHZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gY29sbGVjdGVkO1xuICAgICAgICAgICAgY2FzZSBcIk9yRXhwcmVzc2lvblwiOlxuICAgICAgICAgICAgICBtYXRjaGVkID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzBdLCB2YWx1ZSk7XG4gICAgICAgICAgICAgIGlmIChpc0ZhbHNlKG1hdGNoZWQpKSB7XG4gICAgICAgICAgICAgICAgICBtYXRjaGVkID0gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCB2YWx1ZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIG1hdGNoZWQ7XG4gICAgICAgICAgICBjYXNlIFwiQW5kRXhwcmVzc2lvblwiOlxuICAgICAgICAgICAgICBmaXJzdCA9IHRoaXMudmlzaXQobm9kZS5jaGlsZHJlblswXSwgdmFsdWUpO1xuXG4gICAgICAgICAgICAgIGlmIChpc0ZhbHNlKGZpcnN0KSA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmaXJzdDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gdGhpcy52aXNpdChub2RlLmNoaWxkcmVuWzFdLCB2YWx1ZSk7XG4gICAgICAgICAgICBjYXNlIFwiTm90RXhwcmVzc2lvblwiOlxuICAgICAgICAgICAgICBmaXJzdCA9IHRoaXMudmlzaXQobm9kZS5jaGlsZHJlblswXSwgdmFsdWUpO1xuICAgICAgICAgICAgICByZXR1cm4gaXNGYWxzZShmaXJzdCk7XG4gICAgICAgICAgICBjYXNlIFwiTGl0ZXJhbFwiOlxuICAgICAgICAgICAgICByZXR1cm4gbm9kZS52YWx1ZTtcbiAgICAgICAgICAgIGNhc2UgVE9LX1BJUEU6XG4gICAgICAgICAgICAgIGxlZnQgPSB0aGlzLnZpc2l0KG5vZGUuY2hpbGRyZW5bMF0sIHZhbHVlKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudmlzaXQobm9kZS5jaGlsZHJlblsxXSwgbGVmdCk7XG4gICAgICAgICAgICBjYXNlIFRPS19DVVJSRU5UOlxuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICBjYXNlIFwiRnVuY3Rpb25cIjpcbiAgICAgICAgICAgICAgdmFyIHJlc29sdmVkQXJncyA9IFtdO1xuICAgICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgcmVzb2x2ZWRBcmdzLnB1c2godGhpcy52aXNpdChub2RlLmNoaWxkcmVuW2ldLCB2YWx1ZSkpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLnJ1bnRpbWUuY2FsbEZ1bmN0aW9uKG5vZGUubmFtZSwgcmVzb2x2ZWRBcmdzKTtcbiAgICAgICAgICAgIGNhc2UgXCJFeHByZXNzaW9uUmVmZXJlbmNlXCI6XG4gICAgICAgICAgICAgIHZhciByZWZOb2RlID0gbm9kZS5jaGlsZHJlblswXTtcbiAgICAgICAgICAgICAgLy8gVGFnIHRoZSBub2RlIHdpdGggYSBzcGVjaWZpYyBhdHRyaWJ1dGUgc28gdGhlIHR5cGVcbiAgICAgICAgICAgICAgLy8gY2hlY2tlciB2ZXJpZnkgdGhlIHR5cGUuXG4gICAgICAgICAgICAgIHJlZk5vZGUuam1lc3BhdGhUeXBlID0gVE9LX0VYUFJFRjtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlZk5vZGU7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIG5vZGUgdHlwZTogXCIgKyBub2RlLnR5cGUpO1xuICAgICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIGNvbXB1dGVTbGljZVBhcmFtczogZnVuY3Rpb24oYXJyYXlMZW5ndGgsIHNsaWNlUGFyYW1zKSB7XG4gICAgICAgIHZhciBzdGFydCA9IHNsaWNlUGFyYW1zWzBdO1xuICAgICAgICB2YXIgc3RvcCA9IHNsaWNlUGFyYW1zWzFdO1xuICAgICAgICB2YXIgc3RlcCA9IHNsaWNlUGFyYW1zWzJdO1xuICAgICAgICB2YXIgY29tcHV0ZWQgPSBbbnVsbCwgbnVsbCwgbnVsbF07XG4gICAgICAgIGlmIChzdGVwID09PSBudWxsKSB7XG4gICAgICAgICAgc3RlcCA9IDE7XG4gICAgICAgIH0gZWxzZSBpZiAoc3RlcCA9PT0gMCkge1xuICAgICAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcihcIkludmFsaWQgc2xpY2UsIHN0ZXAgY2Fubm90IGJlIDBcIik7XG4gICAgICAgICAgZXJyb3IubmFtZSA9IFwiUnVudGltZUVycm9yXCI7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN0ZXBWYWx1ZU5lZ2F0aXZlID0gc3RlcCA8IDAgPyB0cnVlIDogZmFsc2U7XG5cbiAgICAgICAgaWYgKHN0YXJ0ID09PSBudWxsKSB7XG4gICAgICAgICAgICBzdGFydCA9IHN0ZXBWYWx1ZU5lZ2F0aXZlID8gYXJyYXlMZW5ndGggLSAxIDogMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXJ0ID0gdGhpcy5jYXBTbGljZVJhbmdlKGFycmF5TGVuZ3RoLCBzdGFydCwgc3RlcCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc3RvcCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgc3RvcCA9IHN0ZXBWYWx1ZU5lZ2F0aXZlID8gLTEgOiBhcnJheUxlbmd0aDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0b3AgPSB0aGlzLmNhcFNsaWNlUmFuZ2UoYXJyYXlMZW5ndGgsIHN0b3AsIHN0ZXApO1xuICAgICAgICB9XG4gICAgICAgIGNvbXB1dGVkWzBdID0gc3RhcnQ7XG4gICAgICAgIGNvbXB1dGVkWzFdID0gc3RvcDtcbiAgICAgICAgY29tcHV0ZWRbMl0gPSBzdGVwO1xuICAgICAgICByZXR1cm4gY29tcHV0ZWQ7XG4gICAgICB9LFxuXG4gICAgICBjYXBTbGljZVJhbmdlOiBmdW5jdGlvbihhcnJheUxlbmd0aCwgYWN0dWFsVmFsdWUsIHN0ZXApIHtcbiAgICAgICAgICBpZiAoYWN0dWFsVmFsdWUgPCAwKSB7XG4gICAgICAgICAgICAgIGFjdHVhbFZhbHVlICs9IGFycmF5TGVuZ3RoO1xuICAgICAgICAgICAgICBpZiAoYWN0dWFsVmFsdWUgPCAwKSB7XG4gICAgICAgICAgICAgICAgICBhY3R1YWxWYWx1ZSA9IHN0ZXAgPCAwID8gLTEgOiAwO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChhY3R1YWxWYWx1ZSA+PSBhcnJheUxlbmd0aCkge1xuICAgICAgICAgICAgICBhY3R1YWxWYWx1ZSA9IHN0ZXAgPCAwID8gYXJyYXlMZW5ndGggLSAxIDogYXJyYXlMZW5ndGg7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZTtcbiAgICAgIH1cblxuICB9O1xuXG4gIGZ1bmN0aW9uIFJ1bnRpbWUoaW50ZXJwcmV0ZXIpIHtcbiAgICB0aGlzLl9pbnRlcnByZXRlciA9IGludGVycHJldGVyO1xuICAgIHRoaXMuZnVuY3Rpb25UYWJsZSA9IHtcbiAgICAgICAgLy8gbmFtZTogW2Z1bmN0aW9uLCA8c2lnbmF0dXJlPl1cbiAgICAgICAgLy8gVGhlIDxzaWduYXR1cmU+IGNhbiBiZTpcbiAgICAgICAgLy9cbiAgICAgICAgLy8ge1xuICAgICAgICAvLyAgIGFyZ3M6IFtbdHlwZTEsIHR5cGUyXSwgW3R5cGUxLCB0eXBlMl1dLFxuICAgICAgICAvLyAgIHZhcmlhZGljOiB0cnVlfGZhbHNlXG4gICAgICAgIC8vIH1cbiAgICAgICAgLy9cbiAgICAgICAgLy8gRWFjaCBhcmcgaW4gdGhlIGFyZyBsaXN0IGlzIGEgbGlzdCBvZiB2YWxpZCB0eXBlc1xuICAgICAgICAvLyAoaWYgdGhlIGZ1bmN0aW9uIGlzIG92ZXJsb2FkZWQgYW5kIHN1cHBvcnRzIG11bHRpcGxlXG4gICAgICAgIC8vIHR5cGVzLiAgSWYgdGhlIHR5cGUgaXMgXCJhbnlcIiB0aGVuIG5vIHR5cGUgY2hlY2tpbmdcbiAgICAgICAgLy8gb2NjdXJzIG9uIHRoZSBhcmd1bWVudC4gIFZhcmlhZGljIGlzIG9wdGlvbmFsXG4gICAgICAgIC8vIGFuZCBpZiBub3QgcHJvdmlkZWQgaXMgYXNzdW1lZCB0byBiZSBmYWxzZS5cbiAgICAgICAgYWJzOiB7X2Z1bmM6IHRoaXMuX2Z1bmN0aW9uQWJzLCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9OVU1CRVJdfV19LFxuICAgICAgICBhdmc6IHtfZnVuYzogdGhpcy5fZnVuY3Rpb25BdmcsIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0FSUkFZX05VTUJFUl19XX0sXG4gICAgICAgIGNlaWw6IHtfZnVuYzogdGhpcy5fZnVuY3Rpb25DZWlsLCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9OVU1CRVJdfV19LFxuICAgICAgICBjb250YWluczoge1xuICAgICAgICAgICAgX2Z1bmM6IHRoaXMuX2Z1bmN0aW9uQ29udGFpbnMsXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9TVFJJTkcsIFRZUEVfQVJSQVldfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHt0eXBlczogW1RZUEVfQU5ZXX1dfSxcbiAgICAgICAgXCJlbmRzX3dpdGhcIjoge1xuICAgICAgICAgICAgX2Z1bmM6IHRoaXMuX2Z1bmN0aW9uRW5kc1dpdGgsXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9TVFJJTkddfSwge3R5cGVzOiBbVFlQRV9TVFJJTkddfV19LFxuICAgICAgICBmbG9vcjoge19mdW5jOiB0aGlzLl9mdW5jdGlvbkZsb29yLCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9OVU1CRVJdfV19LFxuICAgICAgICBsZW5ndGg6IHtcbiAgICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvbkxlbmd0aCxcbiAgICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX1NUUklORywgVFlQRV9BUlJBWSwgVFlQRV9PQkpFQ1RdfV19LFxuICAgICAgICBtYXA6IHtcbiAgICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvbk1hcCxcbiAgICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0VYUFJFRl19LCB7dHlwZXM6IFtUWVBFX0FSUkFZXX1dfSxcbiAgICAgICAgbWF4OiB7XG4gICAgICAgICAgICBfZnVuYzogdGhpcy5fZnVuY3Rpb25NYXgsXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9BUlJBWV9OVU1CRVIsIFRZUEVfQVJSQVlfU1RSSU5HXX1dfSxcbiAgICAgICAgXCJtZXJnZVwiOiB7XG4gICAgICAgICAgICBfZnVuYzogdGhpcy5fZnVuY3Rpb25NZXJnZSxcbiAgICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX09CSkVDVF0sIHZhcmlhZGljOiB0cnVlfV1cbiAgICAgICAgfSxcbiAgICAgICAgXCJtYXhfYnlcIjoge1xuICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvbk1heEJ5LFxuICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0FSUkFZXX0sIHt0eXBlczogW1RZUEVfRVhQUkVGXX1dXG4gICAgICAgIH0sXG4gICAgICAgIHN1bToge19mdW5jOiB0aGlzLl9mdW5jdGlvblN1bSwgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfQVJSQVlfTlVNQkVSXX1dfSxcbiAgICAgICAgXCJzdGFydHNfd2l0aFwiOiB7XG4gICAgICAgICAgICBfZnVuYzogdGhpcy5fZnVuY3Rpb25TdGFydHNXaXRoLFxuICAgICAgICAgICAgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfU1RSSU5HXX0sIHt0eXBlczogW1RZUEVfU1RSSU5HXX1dfSxcbiAgICAgICAgbWluOiB7XG4gICAgICAgICAgICBfZnVuYzogdGhpcy5fZnVuY3Rpb25NaW4sXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9BUlJBWV9OVU1CRVIsIFRZUEVfQVJSQVlfU1RSSU5HXX1dfSxcbiAgICAgICAgXCJtaW5fYnlcIjoge1xuICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvbk1pbkJ5LFxuICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0FSUkFZXX0sIHt0eXBlczogW1RZUEVfRVhQUkVGXX1dXG4gICAgICAgIH0sXG4gICAgICAgIHR5cGU6IHtfZnVuYzogdGhpcy5fZnVuY3Rpb25UeXBlLCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9BTlldfV19LFxuICAgICAgICBrZXlzOiB7X2Z1bmM6IHRoaXMuX2Z1bmN0aW9uS2V5cywgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfT0JKRUNUXX1dfSxcbiAgICAgICAgdmFsdWVzOiB7X2Z1bmM6IHRoaXMuX2Z1bmN0aW9uVmFsdWVzLCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9PQkpFQ1RdfV19LFxuICAgICAgICBzb3J0OiB7X2Z1bmM6IHRoaXMuX2Z1bmN0aW9uU29ydCwgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfQVJSQVlfU1RSSU5HLCBUWVBFX0FSUkFZX05VTUJFUl19XX0sXG4gICAgICAgIFwic29ydF9ieVwiOiB7XG4gICAgICAgICAgX2Z1bmM6IHRoaXMuX2Z1bmN0aW9uU29ydEJ5LFxuICAgICAgICAgIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0FSUkFZXX0sIHt0eXBlczogW1RZUEVfRVhQUkVGXX1dXG4gICAgICAgIH0sXG4gICAgICAgIGpvaW46IHtcbiAgICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvbkpvaW4sXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbXG4gICAgICAgICAgICAgICAge3R5cGVzOiBbVFlQRV9TVFJJTkddfSxcbiAgICAgICAgICAgICAgICB7dHlwZXM6IFtUWVBFX0FSUkFZX1NUUklOR119XG4gICAgICAgICAgICBdXG4gICAgICAgIH0sXG4gICAgICAgIHJldmVyc2U6IHtcbiAgICAgICAgICAgIF9mdW5jOiB0aGlzLl9mdW5jdGlvblJldmVyc2UsXG4gICAgICAgICAgICBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9TVFJJTkcsIFRZUEVfQVJSQVldfV19LFxuICAgICAgICBcInRvX2FycmF5XCI6IHtfZnVuYzogdGhpcy5fZnVuY3Rpb25Ub0FycmF5LCBfc2lnbmF0dXJlOiBbe3R5cGVzOiBbVFlQRV9BTlldfV19LFxuICAgICAgICBcInRvX3N0cmluZ1wiOiB7X2Z1bmM6IHRoaXMuX2Z1bmN0aW9uVG9TdHJpbmcsIF9zaWduYXR1cmU6IFt7dHlwZXM6IFtUWVBFX0FOWV19XX0sXG4gICAgICAgIFwidG9fbnVtYmVyXCI6IHtfZnVuYzogdGhpcy5fZnVuY3Rpb25Ub051bWJlciwgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfQU5ZXX1dfSxcbiAgICAgICAgXCJub3RfbnVsbFwiOiB7XG4gICAgICAgICAgICBfZnVuYzogdGhpcy5fZnVuY3Rpb25Ob3ROdWxsLFxuICAgICAgICAgICAgX3NpZ25hdHVyZTogW3t0eXBlczogW1RZUEVfQU5ZXSwgdmFyaWFkaWM6IHRydWV9XVxuICAgICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIFJ1bnRpbWUucHJvdG90eXBlID0ge1xuICAgIGNhbGxGdW5jdGlvbjogZnVuY3Rpb24obmFtZSwgcmVzb2x2ZWRBcmdzKSB7XG4gICAgICB2YXIgZnVuY3Rpb25FbnRyeSA9IHRoaXMuZnVuY3Rpb25UYWJsZVtuYW1lXTtcbiAgICAgIGlmIChmdW5jdGlvbkVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIGZ1bmN0aW9uOiBcIiArIG5hbWUgKyBcIigpXCIpO1xuICAgICAgfVxuICAgICAgdGhpcy5fdmFsaWRhdGVBcmdzKG5hbWUsIHJlc29sdmVkQXJncywgZnVuY3Rpb25FbnRyeS5fc2lnbmF0dXJlKTtcbiAgICAgIHJldHVybiBmdW5jdGlvbkVudHJ5Ll9mdW5jLmNhbGwodGhpcywgcmVzb2x2ZWRBcmdzKTtcbiAgICB9LFxuXG4gICAgX3ZhbGlkYXRlQXJnczogZnVuY3Rpb24obmFtZSwgYXJncywgc2lnbmF0dXJlKSB7XG4gICAgICAgIC8vIFZhbGlkYXRpbmcgdGhlIGFyZ3MgcmVxdWlyZXMgdmFsaWRhdGluZ1xuICAgICAgICAvLyB0aGUgY29ycmVjdCBhcml0eSBhbmQgdGhlIGNvcnJlY3QgdHlwZSBvZiBlYWNoIGFyZy5cbiAgICAgICAgLy8gSWYgdGhlIGxhc3QgYXJndW1lbnQgaXMgZGVjbGFyZWQgYXMgdmFyaWFkaWMsIHRoZW4gd2UgbmVlZFxuICAgICAgICAvLyBhIG1pbmltdW0gbnVtYmVyIG9mIGFyZ3MgdG8gYmUgcmVxdWlyZWQuICBPdGhlcndpc2UgaXQgaGFzIHRvXG4gICAgICAgIC8vIGJlIGFuIGV4YWN0IGFtb3VudC5cbiAgICAgICAgdmFyIHBsdXJhbGl6ZWQ7XG4gICAgICAgIGlmIChzaWduYXR1cmVbc2lnbmF0dXJlLmxlbmd0aCAtIDFdLnZhcmlhZGljKSB7XG4gICAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPCBzaWduYXR1cmUubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgcGx1cmFsaXplZCA9IHNpZ25hdHVyZS5sZW5ndGggPT09IDEgPyBcIiBhcmd1bWVudFwiIDogXCIgYXJndW1lbnRzXCI7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXJndW1lbnRFcnJvcjogXCIgKyBuYW1lICsgXCIoKSBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwidGFrZXMgYXQgbGVhc3RcIiArIHNpZ25hdHVyZS5sZW5ndGggKyBwbHVyYWxpemVkICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgYnV0IHJlY2VpdmVkIFwiICsgYXJncy5sZW5ndGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGFyZ3MubGVuZ3RoICE9PSBzaWduYXR1cmUubGVuZ3RoKSB7XG4gICAgICAgICAgICBwbHVyYWxpemVkID0gc2lnbmF0dXJlLmxlbmd0aCA9PT0gMSA/IFwiIGFyZ3VtZW50XCIgOiBcIiBhcmd1bWVudHNcIjtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkFyZ3VtZW50RXJyb3I6IFwiICsgbmFtZSArIFwiKCkgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwidGFrZXMgXCIgKyBzaWduYXR1cmUubGVuZ3RoICsgcGx1cmFsaXplZCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgYnV0IHJlY2VpdmVkIFwiICsgYXJncy5sZW5ndGgpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBjdXJyZW50U3BlYztcbiAgICAgICAgdmFyIGFjdHVhbFR5cGU7XG4gICAgICAgIHZhciB0eXBlTWF0Y2hlZDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzaWduYXR1cmUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHR5cGVNYXRjaGVkID0gZmFsc2U7XG4gICAgICAgICAgICBjdXJyZW50U3BlYyA9IHNpZ25hdHVyZVtpXS50eXBlcztcbiAgICAgICAgICAgIGFjdHVhbFR5cGUgPSB0aGlzLl9nZXRUeXBlTmFtZShhcmdzW2ldKTtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgY3VycmVudFNwZWMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fdHlwZU1hdGNoZXMoYWN0dWFsVHlwZSwgY3VycmVudFNwZWNbal0sIGFyZ3NbaV0pKSB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGVNYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCF0eXBlTWF0Y2hlZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlR5cGVFcnJvcjogXCIgKyBuYW1lICsgXCIoKSBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiZXhwZWN0ZWQgYXJndW1lbnQgXCIgKyAoaSArIDEpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgdG8gYmUgdHlwZSBcIiArIGN1cnJlbnRTcGVjICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgYnV0IHJlY2VpdmVkIHR5cGUgXCIgKyBhY3R1YWxUeXBlICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgaW5zdGVhZC5cIik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX3R5cGVNYXRjaGVzOiBmdW5jdGlvbihhY3R1YWwsIGV4cGVjdGVkLCBhcmdWYWx1ZSkge1xuICAgICAgICBpZiAoZXhwZWN0ZWQgPT09IFRZUEVfQU5ZKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXhwZWN0ZWQgPT09IFRZUEVfQVJSQVlfU1RSSU5HIHx8XG4gICAgICAgICAgICBleHBlY3RlZCA9PT0gVFlQRV9BUlJBWV9OVU1CRVIgfHxcbiAgICAgICAgICAgIGV4cGVjdGVkID09PSBUWVBFX0FSUkFZKSB7XG4gICAgICAgICAgICAvLyBUaGUgZXhwZWN0ZWQgdHlwZSBjYW4gZWl0aGVyIGp1c3QgYmUgYXJyYXksXG4gICAgICAgICAgICAvLyBvciBpdCBjYW4gcmVxdWlyZSBhIHNwZWNpZmljIHN1YnR5cGUgKGFycmF5IG9mIG51bWJlcnMpLlxuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIFRoZSBzaW1wbGVzdCBjYXNlIGlzIGlmIFwiYXJyYXlcIiB3aXRoIG5vIHN1YnR5cGUgaXMgc3BlY2lmaWVkLlxuICAgICAgICAgICAgaWYgKGV4cGVjdGVkID09PSBUWVBFX0FSUkFZKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGFjdHVhbCA9PT0gVFlQRV9BUlJBWTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYWN0dWFsID09PSBUWVBFX0FSUkFZKSB7XG4gICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIG5lZWQgdG8gY2hlY2sgc3VidHlwZXMuXG4gICAgICAgICAgICAgICAgLy8gSSB0aGluayB0aGlzIGhhcyBwb3RlbnRpYWwgdG8gYmUgaW1wcm92ZWQuXG4gICAgICAgICAgICAgICAgdmFyIHN1YnR5cGU7XG4gICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkID09PSBUWVBFX0FSUkFZX05VTUJFUikge1xuICAgICAgICAgICAgICAgICAgc3VidHlwZSA9IFRZUEVfTlVNQkVSO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZXhwZWN0ZWQgPT09IFRZUEVfQVJSQVlfU1RSSU5HKSB7XG4gICAgICAgICAgICAgICAgICBzdWJ0eXBlID0gVFlQRV9TVFJJTkc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJnVmFsdWUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLl90eXBlTWF0Y2hlcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9nZXRUeXBlTmFtZShhcmdWYWx1ZVtpXSksIHN1YnR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcmdWYWx1ZVtpXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBhY3R1YWwgPT09IGV4cGVjdGVkO1xuICAgICAgICB9XG4gICAgfSxcbiAgICBfZ2V0VHlwZU5hbWU6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICBzd2l0Y2ggKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopKSB7XG4gICAgICAgICAgICBjYXNlIFwiW29iamVjdCBTdHJpbmddXCI6XG4gICAgICAgICAgICAgIHJldHVybiBUWVBFX1NUUklORztcbiAgICAgICAgICAgIGNhc2UgXCJbb2JqZWN0IE51bWJlcl1cIjpcbiAgICAgICAgICAgICAgcmV0dXJuIFRZUEVfTlVNQkVSO1xuICAgICAgICAgICAgY2FzZSBcIltvYmplY3QgQXJyYXldXCI6XG4gICAgICAgICAgICAgIHJldHVybiBUWVBFX0FSUkFZO1xuICAgICAgICAgICAgY2FzZSBcIltvYmplY3QgQm9vbGVhbl1cIjpcbiAgICAgICAgICAgICAgcmV0dXJuIFRZUEVfQk9PTEVBTjtcbiAgICAgICAgICAgIGNhc2UgXCJbb2JqZWN0IE51bGxdXCI6XG4gICAgICAgICAgICAgIHJldHVybiBUWVBFX05VTEw7XG4gICAgICAgICAgICBjYXNlIFwiW29iamVjdCBPYmplY3RdXCI6XG4gICAgICAgICAgICAgIC8vIENoZWNrIGlmIGl0J3MgYW4gZXhwcmVmLiAgSWYgaXQgaGFzLCBpdCdzIGJlZW5cbiAgICAgICAgICAgICAgLy8gdGFnZ2VkIHdpdGggYSBqbWVzcGF0aFR5cGUgYXR0ciBvZiAnRXhwcmVmJztcbiAgICAgICAgICAgICAgaWYgKG9iai5qbWVzcGF0aFR5cGUgPT09IFRPS19FWFBSRUYpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gVFlQRV9FWFBSRUY7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFRZUEVfT0JKRUNUO1xuICAgICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uU3RhcnRzV2l0aDogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlZEFyZ3NbMF0ubGFzdEluZGV4T2YocmVzb2x2ZWRBcmdzWzFdKSA9PT0gMDtcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uRW5kc1dpdGg6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICB2YXIgc2VhcmNoU3RyID0gcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgICB2YXIgc3VmZml4ID0gcmVzb2x2ZWRBcmdzWzFdO1xuICAgICAgICByZXR1cm4gc2VhcmNoU3RyLmluZGV4T2Yoc3VmZml4LCBzZWFyY2hTdHIubGVuZ3RoIC0gc3VmZml4Lmxlbmd0aCkgIT09IC0xO1xuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25SZXZlcnNlOiBmdW5jdGlvbihyZXNvbHZlZEFyZ3MpIHtcbiAgICAgICAgdmFyIHR5cGVOYW1lID0gdGhpcy5fZ2V0VHlwZU5hbWUocmVzb2x2ZWRBcmdzWzBdKTtcbiAgICAgICAgaWYgKHR5cGVOYW1lID09PSBUWVBFX1NUUklORykge1xuICAgICAgICAgIHZhciBvcmlnaW5hbFN0ciA9IHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgICB2YXIgcmV2ZXJzZWRTdHIgPSBcIlwiO1xuICAgICAgICAgIGZvciAodmFyIGkgPSBvcmlnaW5hbFN0ci5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgICByZXZlcnNlZFN0ciArPSBvcmlnaW5hbFN0cltpXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHJldmVyc2VkU3RyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciByZXZlcnNlZEFycmF5ID0gcmVzb2x2ZWRBcmdzWzBdLnNsaWNlKDApO1xuICAgICAgICAgIHJldmVyc2VkQXJyYXkucmV2ZXJzZSgpO1xuICAgICAgICAgIHJldHVybiByZXZlcnNlZEFycmF5O1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbkFiczogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICByZXR1cm4gTWF0aC5hYnMocmVzb2x2ZWRBcmdzWzBdKTtcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uQ2VpbDogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIHJldHVybiBNYXRoLmNlaWwocmVzb2x2ZWRBcmdzWzBdKTtcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uQXZnOiBmdW5jdGlvbihyZXNvbHZlZEFyZ3MpIHtcbiAgICAgICAgdmFyIHN1bSA9IDA7XG4gICAgICAgIHZhciBpbnB1dEFycmF5ID0gcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlucHV0QXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHN1bSArPSBpbnB1dEFycmF5W2ldO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzdW0gLyBpbnB1dEFycmF5Lmxlbmd0aDtcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uQ29udGFpbnM6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICByZXR1cm4gcmVzb2x2ZWRBcmdzWzBdLmluZGV4T2YocmVzb2x2ZWRBcmdzWzFdKSA+PSAwO1xuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25GbG9vcjogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKHJlc29sdmVkQXJnc1swXSk7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbkxlbmd0aDogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgaWYgKCFpc09iamVjdChyZXNvbHZlZEFyZ3NbMF0pKSB7XG4gICAgICAgICByZXR1cm4gcmVzb2x2ZWRBcmdzWzBdLmxlbmd0aDtcbiAgICAgICB9IGVsc2Uge1xuICAgICAgICAgLy8gQXMgZmFyIGFzIEkgY2FuIHRlbGwsIHRoZXJlJ3Mgbm8gd2F5IHRvIGdldCB0aGUgbGVuZ3RoXG4gICAgICAgICAvLyBvZiBhbiBvYmplY3Qgd2l0aG91dCBPKG4pIGl0ZXJhdGlvbiB0aHJvdWdoIHRoZSBvYmplY3QuXG4gICAgICAgICByZXR1cm4gT2JqZWN0LmtleXMocmVzb2x2ZWRBcmdzWzBdKS5sZW5ndGg7XG4gICAgICAgfVxuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25NYXA6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgdmFyIG1hcHBlZCA9IFtdO1xuICAgICAgdmFyIGludGVycHJldGVyID0gdGhpcy5faW50ZXJwcmV0ZXI7XG4gICAgICB2YXIgZXhwcmVmTm9kZSA9IHJlc29sdmVkQXJnc1swXTtcbiAgICAgIHZhciBlbGVtZW50cyA9IHJlc29sdmVkQXJnc1sxXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBtYXBwZWQucHVzaChpbnRlcnByZXRlci52aXNpdChleHByZWZOb2RlLCBlbGVtZW50c1tpXSkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1hcHBlZDtcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uTWVyZ2U6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgdmFyIG1lcmdlZCA9IHt9O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXNvbHZlZEFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGN1cnJlbnQgPSByZXNvbHZlZEFyZ3NbaV07XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBjdXJyZW50KSB7XG4gICAgICAgICAgbWVyZ2VkW2tleV0gPSBjdXJyZW50W2tleV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbk1heDogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICBpZiAocmVzb2x2ZWRBcmdzWzBdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdmFyIHR5cGVOYW1lID0gdGhpcy5fZ2V0VHlwZU5hbWUocmVzb2x2ZWRBcmdzWzBdWzBdKTtcbiAgICAgICAgaWYgKHR5cGVOYW1lID09PSBUWVBFX05VTUJFUikge1xuICAgICAgICAgIHJldHVybiBNYXRoLm1heC5hcHBseShNYXRoLCByZXNvbHZlZEFyZ3NbMF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBlbGVtZW50cyA9IHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgICB2YXIgbWF4RWxlbWVudCA9IGVsZW1lbnRzWzBdO1xuICAgICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgaWYgKG1heEVsZW1lbnQubG9jYWxlQ29tcGFyZShlbGVtZW50c1tpXSkgPCAwKSB7XG4gICAgICAgICAgICAgICAgICBtYXhFbGVtZW50ID0gZWxlbWVudHNbaV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG1heEVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbk1pbjogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICBpZiAocmVzb2x2ZWRBcmdzWzBdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdmFyIHR5cGVOYW1lID0gdGhpcy5fZ2V0VHlwZU5hbWUocmVzb2x2ZWRBcmdzWzBdWzBdKTtcbiAgICAgICAgaWYgKHR5cGVOYW1lID09PSBUWVBFX05VTUJFUikge1xuICAgICAgICAgIHJldHVybiBNYXRoLm1pbi5hcHBseShNYXRoLCByZXNvbHZlZEFyZ3NbMF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBlbGVtZW50cyA9IHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgICB2YXIgbWluRWxlbWVudCA9IGVsZW1lbnRzWzBdO1xuICAgICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgaWYgKGVsZW1lbnRzW2ldLmxvY2FsZUNvbXBhcmUobWluRWxlbWVudCkgPCAwKSB7XG4gICAgICAgICAgICAgICAgICBtaW5FbGVtZW50ID0gZWxlbWVudHNbaV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG1pbkVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25TdW06IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgdmFyIHN1bSA9IDA7XG4gICAgICB2YXIgbGlzdFRvU3VtID0gcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0VG9TdW0ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgc3VtICs9IGxpc3RUb1N1bVtpXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzdW07XG4gICAgfSxcblxuICAgIF9mdW5jdGlvblR5cGU6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICBzd2l0Y2ggKHRoaXMuX2dldFR5cGVOYW1lKHJlc29sdmVkQXJnc1swXSkpIHtcbiAgICAgICAgICBjYXNlIFRZUEVfTlVNQkVSOlxuICAgICAgICAgICAgcmV0dXJuIFwibnVtYmVyXCI7XG4gICAgICAgICAgY2FzZSBUWVBFX1NUUklORzpcbiAgICAgICAgICAgIHJldHVybiBcInN0cmluZ1wiO1xuICAgICAgICAgIGNhc2UgVFlQRV9BUlJBWTpcbiAgICAgICAgICAgIHJldHVybiBcImFycmF5XCI7XG4gICAgICAgICAgY2FzZSBUWVBFX09CSkVDVDpcbiAgICAgICAgICAgIHJldHVybiBcIm9iamVjdFwiO1xuICAgICAgICAgIGNhc2UgVFlQRV9CT09MRUFOOlxuICAgICAgICAgICAgcmV0dXJuIFwiYm9vbGVhblwiO1xuICAgICAgICAgIGNhc2UgVFlQRV9FWFBSRUY6XG4gICAgICAgICAgICByZXR1cm4gXCJleHByZWZcIjtcbiAgICAgICAgICBjYXNlIFRZUEVfTlVMTDpcbiAgICAgICAgICAgIHJldHVybiBcIm51bGxcIjtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25LZXlzOiBmdW5jdGlvbihyZXNvbHZlZEFyZ3MpIHtcbiAgICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKHJlc29sdmVkQXJnc1swXSk7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvblZhbHVlczogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIHZhciBvYmogPSByZXNvbHZlZEFyZ3NbMF07XG4gICAgICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMob2JqKTtcbiAgICAgICAgdmFyIHZhbHVlcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKG9ialtrZXlzW2ldXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhbHVlcztcbiAgICB9LFxuXG4gICAgX2Z1bmN0aW9uSm9pbjogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIHZhciBqb2luQ2hhciA9IHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgdmFyIGxpc3RKb2luID0gcmVzb2x2ZWRBcmdzWzFdO1xuICAgICAgICByZXR1cm4gbGlzdEpvaW4uam9pbihqb2luQ2hhcik7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvblRvQXJyYXk6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICBpZiAodGhpcy5fZ2V0VHlwZU5hbWUocmVzb2x2ZWRBcmdzWzBdKSA9PT0gVFlQRV9BUlJBWSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBbcmVzb2x2ZWRBcmdzWzBdXTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25Ub1N0cmluZzogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICAgIGlmICh0aGlzLl9nZXRUeXBlTmFtZShyZXNvbHZlZEFyZ3NbMF0pID09PSBUWVBFX1NUUklORykge1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmVkQXJnc1swXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShyZXNvbHZlZEFyZ3NbMF0pO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9mdW5jdGlvblRvTnVtYmVyOiBmdW5jdGlvbihyZXNvbHZlZEFyZ3MpIHtcbiAgICAgICAgdmFyIHR5cGVOYW1lID0gdGhpcy5fZ2V0VHlwZU5hbWUocmVzb2x2ZWRBcmdzWzBdKTtcbiAgICAgICAgdmFyIGNvbnZlcnRlZFZhbHVlO1xuICAgICAgICBpZiAodHlwZU5hbWUgPT09IFRZUEVfTlVNQkVSKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVOYW1lID09PSBUWVBFX1NUUklORykge1xuICAgICAgICAgICAgY29udmVydGVkVmFsdWUgPSArcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgICAgICAgaWYgKCFpc05hTihjb252ZXJ0ZWRWYWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udmVydGVkVmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbk5vdE51bGw6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlc29sdmVkQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKHRoaXMuX2dldFR5cGVOYW1lKHJlc29sdmVkQXJnc1tpXSkgIT09IFRZUEVfTlVMTCkge1xuICAgICAgICAgICAgICAgIHJldHVybiByZXNvbHZlZEFyZ3NbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvblNvcnQ6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICB2YXIgc29ydGVkQXJyYXkgPSByZXNvbHZlZEFyZ3NbMF0uc2xpY2UoMCk7XG4gICAgICAgIHNvcnRlZEFycmF5LnNvcnQoKTtcbiAgICAgICAgcmV0dXJuIHNvcnRlZEFycmF5O1xuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25Tb3J0Qnk6IGZ1bmN0aW9uKHJlc29sdmVkQXJncykge1xuICAgICAgICB2YXIgc29ydGVkQXJyYXkgPSByZXNvbHZlZEFyZ3NbMF0uc2xpY2UoMCk7XG4gICAgICAgIGlmIChzb3J0ZWRBcnJheS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBzb3J0ZWRBcnJheTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaW50ZXJwcmV0ZXIgPSB0aGlzLl9pbnRlcnByZXRlcjtcbiAgICAgICAgdmFyIGV4cHJlZk5vZGUgPSByZXNvbHZlZEFyZ3NbMV07XG4gICAgICAgIHZhciByZXF1aXJlZFR5cGUgPSB0aGlzLl9nZXRUeXBlTmFtZShcbiAgICAgICAgICAgIGludGVycHJldGVyLnZpc2l0KGV4cHJlZk5vZGUsIHNvcnRlZEFycmF5WzBdKSk7XG4gICAgICAgIGlmIChbVFlQRV9OVU1CRVIsIFRZUEVfU1RSSU5HXS5pbmRleE9mKHJlcXVpcmVkVHlwZSkgPCAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUeXBlRXJyb3JcIik7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuICAgICAgICAvLyBJbiBvcmRlciB0byBnZXQgYSBzdGFibGUgc29ydCBvdXQgb2YgYW4gdW5zdGFibGVcbiAgICAgICAgLy8gc29ydCBhbGdvcml0aG0sIHdlIGRlY29yYXRlL3NvcnQvdW5kZWNvcmF0ZSAoRFNVKVxuICAgICAgICAvLyBieSBjcmVhdGluZyBhIG5ldyBsaXN0IG9mIFtpbmRleCwgZWxlbWVudF0gcGFpcnMuXG4gICAgICAgIC8vIEluIHRoZSBjbXAgZnVuY3Rpb24sIGlmIHRoZSBldmFsdWF0ZWQgZWxlbWVudHMgYXJlXG4gICAgICAgIC8vIGVxdWFsLCB0aGVuIHRoZSBpbmRleCB3aWxsIGJlIHVzZWQgYXMgdGhlIHRpZWJyZWFrZXIuXG4gICAgICAgIC8vIEFmdGVyIHRoZSBkZWNvcmF0ZWQgbGlzdCBoYXMgYmVlbiBzb3J0ZWQsIGl0IHdpbGwgYmVcbiAgICAgICAgLy8gdW5kZWNvcmF0ZWQgdG8gZXh0cmFjdCB0aGUgb3JpZ2luYWwgZWxlbWVudHMuXG4gICAgICAgIHZhciBkZWNvcmF0ZWQgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzb3J0ZWRBcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGRlY29yYXRlZC5wdXNoKFtpLCBzb3J0ZWRBcnJheVtpXV0pO1xuICAgICAgICB9XG4gICAgICAgIGRlY29yYXRlZC5zb3J0KGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICB2YXIgZXhwckEgPSBpbnRlcnByZXRlci52aXNpdChleHByZWZOb2RlLCBhWzFdKTtcbiAgICAgICAgICB2YXIgZXhwckIgPSBpbnRlcnByZXRlci52aXNpdChleHByZWZOb2RlLCBiWzFdKTtcbiAgICAgICAgICBpZiAodGhhdC5fZ2V0VHlwZU5hbWUoZXhwckEpICE9PSByZXF1aXJlZFR5cGUpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICAgXCJUeXBlRXJyb3I6IGV4cGVjdGVkIFwiICsgcmVxdWlyZWRUeXBlICsgXCIsIHJlY2VpdmVkIFwiICtcbiAgICAgICAgICAgICAgICAgIHRoYXQuX2dldFR5cGVOYW1lKGV4cHJBKSk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0aGF0Ll9nZXRUeXBlTmFtZShleHByQikgIT09IHJlcXVpcmVkVHlwZSkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICBcIlR5cGVFcnJvcjogZXhwZWN0ZWQgXCIgKyByZXF1aXJlZFR5cGUgKyBcIiwgcmVjZWl2ZWQgXCIgK1xuICAgICAgICAgICAgICAgICAgdGhhdC5fZ2V0VHlwZU5hbWUoZXhwckIpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGV4cHJBID4gZXhwckIpIHtcbiAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZXhwckEgPCBleHByQikge1xuICAgICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBJZiB0aGV5J3JlIGVxdWFsIGNvbXBhcmUgdGhlIGl0ZW1zIGJ5IHRoZWlyXG4gICAgICAgICAgICAvLyBvcmRlciB0byBtYWludGFpbiByZWxhdGl2ZSBvcmRlciBvZiBlcXVhbCBrZXlzXG4gICAgICAgICAgICAvLyAoaS5lLiB0byBnZXQgYSBzdGFibGUgc29ydCkuXG4gICAgICAgICAgICByZXR1cm4gYVswXSAtIGJbMF07XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgLy8gVW5kZWNvcmF0ZTogZXh0cmFjdCBvdXQgdGhlIG9yaWdpbmFsIGxpc3QgZWxlbWVudHMuXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZGVjb3JhdGVkLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgc29ydGVkQXJyYXlbal0gPSBkZWNvcmF0ZWRbal1bMV07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHNvcnRlZEFycmF5O1xuICAgIH0sXG5cbiAgICBfZnVuY3Rpb25NYXhCeTogZnVuY3Rpb24ocmVzb2x2ZWRBcmdzKSB7XG4gICAgICB2YXIgZXhwcmVmTm9kZSA9IHJlc29sdmVkQXJnc1sxXTtcbiAgICAgIHZhciByZXNvbHZlZEFycmF5ID0gcmVzb2x2ZWRBcmdzWzBdO1xuICAgICAgdmFyIGtleUZ1bmN0aW9uID0gdGhpcy5jcmVhdGVLZXlGdW5jdGlvbihleHByZWZOb2RlLCBbVFlQRV9OVU1CRVIsIFRZUEVfU1RSSU5HXSk7XG4gICAgICB2YXIgbWF4TnVtYmVyID0gLUluZmluaXR5O1xuICAgICAgdmFyIG1heFJlY29yZDtcbiAgICAgIHZhciBjdXJyZW50O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXNvbHZlZEFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGN1cnJlbnQgPSBrZXlGdW5jdGlvbihyZXNvbHZlZEFycmF5W2ldKTtcbiAgICAgICAgaWYgKGN1cnJlbnQgPiBtYXhOdW1iZXIpIHtcbiAgICAgICAgICBtYXhOdW1iZXIgPSBjdXJyZW50O1xuICAgICAgICAgIG1heFJlY29yZCA9IHJlc29sdmVkQXJyYXlbaV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXhSZWNvcmQ7XG4gICAgfSxcblxuICAgIF9mdW5jdGlvbk1pbkJ5OiBmdW5jdGlvbihyZXNvbHZlZEFyZ3MpIHtcbiAgICAgIHZhciBleHByZWZOb2RlID0gcmVzb2x2ZWRBcmdzWzFdO1xuICAgICAgdmFyIHJlc29sdmVkQXJyYXkgPSByZXNvbHZlZEFyZ3NbMF07XG4gICAgICB2YXIga2V5RnVuY3Rpb24gPSB0aGlzLmNyZWF0ZUtleUZ1bmN0aW9uKGV4cHJlZk5vZGUsIFtUWVBFX05VTUJFUiwgVFlQRV9TVFJJTkddKTtcbiAgICAgIHZhciBtaW5OdW1iZXIgPSBJbmZpbml0eTtcbiAgICAgIHZhciBtaW5SZWNvcmQ7XG4gICAgICB2YXIgY3VycmVudDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzb2x2ZWRBcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICBjdXJyZW50ID0ga2V5RnVuY3Rpb24ocmVzb2x2ZWRBcnJheVtpXSk7XG4gICAgICAgIGlmIChjdXJyZW50IDwgbWluTnVtYmVyKSB7XG4gICAgICAgICAgbWluTnVtYmVyID0gY3VycmVudDtcbiAgICAgICAgICBtaW5SZWNvcmQgPSByZXNvbHZlZEFycmF5W2ldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gbWluUmVjb3JkO1xuICAgIH0sXG5cbiAgICBjcmVhdGVLZXlGdW5jdGlvbjogZnVuY3Rpb24oZXhwcmVmTm9kZSwgYWxsb3dlZFR5cGVzKSB7XG4gICAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgICB2YXIgaW50ZXJwcmV0ZXIgPSB0aGlzLl9pbnRlcnByZXRlcjtcbiAgICAgIHZhciBrZXlGdW5jID0gZnVuY3Rpb24oeCkge1xuICAgICAgICB2YXIgY3VycmVudCA9IGludGVycHJldGVyLnZpc2l0KGV4cHJlZk5vZGUsIHgpO1xuICAgICAgICBpZiAoYWxsb3dlZFR5cGVzLmluZGV4T2YodGhhdC5fZ2V0VHlwZU5hbWUoY3VycmVudCkpIDwgMCkge1xuICAgICAgICAgIHZhciBtc2cgPSBcIlR5cGVFcnJvcjogZXhwZWN0ZWQgb25lIG9mIFwiICsgYWxsb3dlZFR5cGVzICtcbiAgICAgICAgICAgICAgICAgICAgXCIsIHJlY2VpdmVkIFwiICsgdGhhdC5fZ2V0VHlwZU5hbWUoY3VycmVudCk7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGN1cnJlbnQ7XG4gICAgICB9O1xuICAgICAgcmV0dXJuIGtleUZ1bmM7XG4gICAgfVxuXG4gIH07XG5cbiAgZnVuY3Rpb24gY29tcGlsZShzdHJlYW0pIHtcbiAgICB2YXIgcGFyc2VyID0gbmV3IFBhcnNlcigpO1xuICAgIHZhciBhc3QgPSBwYXJzZXIucGFyc2Uoc3RyZWFtKTtcbiAgICByZXR1cm4gYXN0O1xuICB9XG5cbiAgZnVuY3Rpb24gdG9rZW5pemUoc3RyZWFtKSB7XG4gICAgICB2YXIgbGV4ZXIgPSBuZXcgTGV4ZXIoKTtcbiAgICAgIHJldHVybiBsZXhlci50b2tlbml6ZShzdHJlYW0pO1xuICB9XG5cbiAgZnVuY3Rpb24gc2VhcmNoKGRhdGEsIGV4cHJlc3Npb24pIHtcbiAgICAgIHZhciBwYXJzZXIgPSBuZXcgUGFyc2VyKCk7XG4gICAgICAvLyBUaGlzIG5lZWRzIHRvIGJlIGltcHJvdmVkLiAgQm90aCB0aGUgaW50ZXJwcmV0ZXIgYW5kIHJ1bnRpbWUgZGVwZW5kIG9uXG4gICAgICAvLyBlYWNoIG90aGVyLiAgVGhlIHJ1bnRpbWUgbmVlZHMgdGhlIGludGVycHJldGVyIHRvIHN1cHBvcnQgZXhwcmVmcy5cbiAgICAgIC8vIFRoZXJlJ3MgbGlrZWx5IGEgY2xlYW4gd2F5IHRvIGF2b2lkIHRoZSBjeWNsaWMgZGVwZW5kZW5jeS5cbiAgICAgIHZhciBydW50aW1lID0gbmV3IFJ1bnRpbWUoKTtcbiAgICAgIHZhciBpbnRlcnByZXRlciA9IG5ldyBUcmVlSW50ZXJwcmV0ZXIocnVudGltZSk7XG4gICAgICBydW50aW1lLl9pbnRlcnByZXRlciA9IGludGVycHJldGVyO1xuICAgICAgdmFyIG5vZGUgPSBwYXJzZXIucGFyc2UoZXhwcmVzc2lvbik7XG4gICAgICByZXR1cm4gaW50ZXJwcmV0ZXIuc2VhcmNoKG5vZGUsIGRhdGEpO1xuICB9XG5cbiAgZXhwb3J0cy50b2tlbml6ZSA9IHRva2VuaXplO1xuICBleHBvcnRzLmNvbXBpbGUgPSBjb21waWxlO1xuICBleHBvcnRzLnNlYXJjaCA9IHNlYXJjaDtcbiAgZXhwb3J0cy5zdHJpY3REZWVwRXF1YWwgPSBzdHJpY3REZWVwRXF1YWw7XG59KSh0eXBlb2YgZXhwb3J0cyA9PT0gXCJ1bmRlZmluZWRcIiA/IHRoaXMuam1lc3BhdGggPSB7fSA6IGV4cG9ydHMpO1xuIiwiJ3VzZSBzdHJpY3QnXG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBEQVRFX0ZPUk1BVDogJ3l5eXktbW0tZGQgSEg6TU06c3MubCBvJyxcbiAgTUVTU0FHRV9LRVk6ICdtc2cnXG59XG4iLCIvKlxuICogICsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrK1xuICogIENvcHlyaWdodCAyMDE5IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKiAgU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiAqICArKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKytcbiAqL1xuXG5pbXBvcnQgcGlubyBmcm9tICdwaW5vJztcbmltcG9ydCBwcmV0dGlmaWVyIGZyb20gJ3Bpbm8tcHJldHR5JztcblxuY29uc3QgY29uZmlnID0ge1xuICBuYW1lOiAnbG9zdC1pbi10cmFuc2xhdGlvbi1za2lsbCcsXG4gIGxldmVsOiBwcm9jZXNzLmVudi5MT0dHRVJfTEVWRUwgfHwgJ2RlYnVnJyxcbiAgcHJldHR5UHJpbnQ6IHtcbiAgICBsZXZlbEZpcnN0OiB0cnVlXG4gIH0sXG4gIHByZXR0aWZpZXJcbn07XG5cbmNvbnN0IGxvZ2dlciA9IHBpbm8oY29uZmlnKTtcblxuZXhwb3J0IGRlZmF1bHQgbG9nZ2VyO1xuXG4iLCIvKlxuICogICsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrK1xuICogIENvcHlyaWdodCAyMDE5IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKiAgU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiAqICArKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKytcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbmltcG9ydCB7aW5zcGVjdH0gZnJvbSAndXRpbCc7XG5pbXBvcnQge1RpbWV9IGZyb20gJy4uL3NlcnZpY2VzL3RpbWUuc2VydmljZSc7XG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcblxuY29uc3QgT1JERVJFRF9EQVlTX09GX1dFRUsgPSBbXG4gICAgJ1N1bmRheScsXG4gICAgJ01vbmRheScsXG4gICAgJ1R1ZXNkYXknLFxuICAgICdXZWRuZXNkYXknLFxuICAgICdUaHVyc2RheScsXG4gICAgJ0ZyaWRheScsXG4gICAgJ1NhdHVyZGF5J1xuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIHRvZGF5TmFtZSh0aW1lU2VydmljZSA9IFRpbWUpIHtcbiAgICBjb25zdCBkYXkgPSB0aW1lU2VydmljZS5zZXJ2ZXJUaW1lR2V0RGF5KCk7XG4gICAgcmV0dXJuIE9SREVSRURfREFZU19PRl9XRUVLW2RheV07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGROdW1iZXJzKC4uLm51bWJlcnMpIHtcbiAgICBsb2dnZXIuaW5mbyhgdGhlIGFyZ3VtZW50cyBhcmUgJHtpbnNwZWN0KG51bWJlcnMpfWApO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG51bWJlcnMpLnJlZHVjZSgoYWNjdW11bGF0b3IsIG51bWJlcikgPT4gYWNjdW11bGF0b3IgKyBudW1iZXIsIDApO1xufVxuXG4iXSwic291cmNlUm9vdCI6IiJ9


__language.dbTypes = {
  master: Master
};
enterState.launch = async function(context) {
  context.say.push( "Welcome to Lost in Translation, a game where you try and understand me through my different accents." );
  if (context.db.read('tutorialHeard') === true) {
    context.say.push( "Do you want to hear the tutorial again?" );
    context.nextState = 'askForTutorial';
  }
  else {
    context.nextState = 'playTutorial';
  }
};
processIntents.launch = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.launch = async function(context) {
};

enterState.global = async function(context) {
};
processIntents.global = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if (!runOtherwise) { return false; }
      console.error('unhandled intent ' + context.intent + ' in state ' + context.handoffState);
      break;
    }
    case 'AMAZON.StopIntent': {
      context.shouldEndSession = true;
      break;
    }
    case 'AMAZON.CancelIntent': {
      context.shouldEndSession = true;
      break;
    }
    case 'AMAZON.StartOverIntent': {
      context.nextState = 'launch';
      break;
    }
  }
  return true;
};
exitState.global = async function(context) {
};

enterState.playTutorial = async function(context) {
  context.say.push( "I'm going to say a phrase, and you have to guess what I say." );
  context.say.push( "For example, if I say" );
  context.say.push(  "<audio src='" + litexa.assetsRoot + "default/bag_of_potatoes.mp3'/>"  );
  context.say.push( "You would translate to," );
  context.say.push(  "<audio src='" + litexa.assetsRoot + "default/bag_of_potatoes2.mp3'/>"  );
  context.say.push( "You can ask me for help by saying, Alexa, help. Or ask me to repeat the phrase by saying, repeat." );
  context.say.push( "You can give up on a phrase by saying, Alexa, skip." );
  context.say.push( "You can relist all of these options during the game by saying, Alexa, options." );
  context.db.write('tutorialHeard', true);
  context.nextState = 'getTopic';
};
processIntents.playTutorial = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.playTutorial = async function(context) {
};

enterState.askForTutorial = async function(context) {
};
processIntents.askForTutorial = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, false) ) { return true; }
      context.say.push( "Do you want to hear the tutorial again?" );
      context.nextState = 'askForTutorial';
      break;
    }
    case 'AMAZON.YesIntent': {
      context.nextState = 'playTutorial';
      break;
    }
    case 'AMAZON.NoIntent': {
      context.say.push( "Alright, let's get into it." );
      context.nextState = 'getTopic';
      break;
    }
  }
  return true;
};
exitState.askForTutorial = async function(context) {
};

enterState.getTopic = async function(context) {
  context.say.push( "The current topic right now is, Movie Quotes." );
  context.say.push( "You'll have five minutes to score as many points as you can, with each translation correct being a point." );
  context.say.push( "Ready?" );
  switch(pickSayString(context, 1, 2)) {
    case 0:
      context.say.push(  "<audio src='" + litexa.assetsRoot + "default/starto.mp3'/>"  );
      break;
    default:
      context.say.push( "<say-as interpret-as='interjection'>batter up</say-as>" );
      break;
  }
  context.db.write('gameStartedTime', context.now);
  context.db.write('score', 0);
  context.db.write('gameInProgress', true);
  context.nextState = 'generateRandomSpeech';
};
processIntents.getTopic = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.getTopic = async function(context) {
};

enterState.generateRandomSpeech = async function(context) {
  if (await context.db.read('master').speechAvailable() === false) {
    context.say.push( "No more translations available," );
    context.say.push( "Goodbye." );
    context.nextState = 'goodbye';
  }
  else {
    context.db.write('speechKey', await context.db.read('master').getRandomSpeech());
    if (await context.db.read('master').seenBefore(context.db.read('speechKey'))) {
      context.nextState = 'generateRandomSpeech';
    }
    else {
      await context.db.read('master').seen(context.db.read('speechKey'))
      context.db.write('temp', ("https://lost-in-translation.s3.amazonaws.com/lost-in-translation/development/default/" + context.db.read('speechKey')) + '.mp3');
      context.nextState = 'askForAnswer';
    }
  }
};
processIntents.generateRandomSpeech = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.generateRandomSpeech = async function(context) {
};

enterState.askForAnswer = async function(context) {
  if (await minutesBetween(context.now, context.db.read('gameStartedTime')) >= 5) {
    context.say.push( "Times up!" );
    context.say.push( "You scored " + escapeSpeech( context.db.read('score') ) + " points." );
    context.nextState = 'askForPlayAgain';
  }
  else {
    context.say.push( "<" + "audio src='" + escapeSpeech( context.db.read('temp') ) + "' />" );
    switch(pickSayString(context, 2, 2)) {
      case 0:
        context.say.push( "What do you think I said?" );
        break;
      default:
        context.say.push( "What did I say?" );
        break;
    }
    context.reprompt.push( "<" + "audio src='" + escapeSpeech( context.db.read('temp') ) + "' />" );
    context.nextState = 'waitForAnswer';
  }
};
processIntents.askForAnswer = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.askForAnswer = async function(context) {
};

enterState.askForRepeat = async function(context) {
  context.say.push( "<" + "audio src='" + escapeSpeech( context.db.read('temp') ) + "' />" );
  context.reprompt.push( "<" + "audio src='" + escapeSpeech( context.db.read('temp') ) + "' />" );
  context.nextState = 'waitForAnswer';
};
processIntents.askForRepeat = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.askForRepeat = async function(context) {
};

enterState.askForPlayAgain = async function(context) {
  context.say.push( "Do you want to play again?" );
  context.nextState = 'waitForPlayAgainAnswer';
};
processIntents.askForPlayAgain = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.askForPlayAgain = async function(context) {
};

enterState.waitForPlayAgainAnswer = async function(context) {
};
processIntents.waitForPlayAgainAnswer = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, false) ) { return true; }
      context.say.push( "Do you want to play again?" );
      context.nextState = 'waitForPlayAgainAnswer';
      break;
    }
    case 'AMAZON.YesIntent': {
      context.say.push( "Alright. Let's go again." );
      context.say.push( "Your last score was " + escapeSpeech( context.db.read('score') ) + " points." );
      context.nextState = 'getTopic';
      break;
    }
    case 'AMAZON.StartOverIntent': {
      context.say.push( "Alright. Let's go again." );
      context.say.push( "Your last score was " + escapeSpeech( context.db.read('score') ) + " points." );
      context.nextState = 'getTopic';
      break;
    }
    case 'AMAZON.NoIntent': {
      context.say.push( "Goodbye." );
      context.nextState = 'goodbye';
      break;
    }
    case 'AMAZON.CancelIntent': {
      context.say.push( "Goodbye." );
      context.nextState = 'goodbye';
      break;
    }
    case 'AMAZON.StopIntent': {
      context.say.push( "Goodbye." );
      context.nextState = 'goodbye';
      break;
    }
  }
  return true;
};
exitState.waitForPlayAgainAnswer = async function(context) {
};

enterState.giveHint = async function(context) {
  exports.Logging.log(JSON.stringify('giveHint'));
  if (await context.db.read('master').hintAvailable(context.db.read('speechKey')) === false) {
    context.say.push( "There are no more hints." );
    context.nextState = 'waitForAnswer';
  }
  else {
    context.db.write('currentHint', await context.db.read('master').getHint(context.db.read('speechKey')));
    if (await context.db.read('master').seenHintBefore(context.db.read('speechKey'), context.db.read('currentHint'))) {
      context.nextState = 'giveHint';
    }
    else {
      await context.db.read('master').seenHint(context.db.read('speechKey'), context.db.read('currentHint'))
      context.say.push( escapeSpeech( context.db.read('currentHint') ) + "." );
      context.nextState = 'waitForAnswer';
    }
  }
};
processIntents.giveHint = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.giveHint = async function(context) {
};

enterState.waitForAnswer = async function(context) {
};
processIntents.waitForAnswer = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, false) ) { return true; }
      context.say.push( "Sorry, I didn't understand. If you want a hint, say, Alexa, help, otherwise say, Alexa, then the answer." );
      context.say.push( "If you want to hear all the options, say, Alexa, options." );
      context.nextState = 'waitForAnswer';
      break;
    }
    case 'ITS_ANSWER': {
      exports.Logging.log(JSON.stringify("What I heard:"));
      exports.Logging.log(JSON.stringify(context.slots.answer));
      exports.Logging.log(JSON.stringify("Correct Answer:"));
      exports.Logging.log(JSON.stringify(await context.db.read('master').getAnswer(context.db.read('speechKey'))));
      if (context.slots.answer && (context.slots.answer === await context.db.read('master').getAnswer(context.db.read('speechKey')))) {
        context.card = {
          title: escapeSpeech( (await context.db.read('master').getAnswer(context.db.read('speechKey'))) ),
          content: escapeSpeech( (await context.db.read('master').getAnnotation(context.db.read('speechKey'))) ),
        };
        switch(pickSayString(context, 3, 11)) {
          case 0:
            context.say.push( "Correcto!" );
            break;
          case 1:
            context.say.push( "Nice job." );
            break;
          case 2:
            context.say.push( "<say-as interpret-as='interjection'>awesome.</say-as>" );
            break;
          case 3:
            context.say.push( "<say-as interpret-as='interjection'>aww yeah.</say-as>" );
            break;
          case 4:
            context.say.push( "<say-as interpret-as='interjection'>bada bing bada boom.</say-as>" );
            break;
          case 5:
            context.say.push( "<say-as interpret-as='interjection'>bingo.</say-as>" );
            break;
          case 6:
            context.say.push( "<say-as interpret-as='interjection'>bazinga.</say-as>" );
            break;
          case 7:
            context.say.push( "<say-as interpret-as='interjection'>well done.</say-as>" );
            break;
          case 8:
            context.say.push( "<say-as interpret-as='interjection'>wowza.</say-as>" );
            break;
          case 9:
            context.say.push( "<say-as interpret-as='interjection'>wowzer.</say-as>" );
            break;
          default:
            context.say.push( "About time!" );
            break;
        }
        context.say.push( escapeSpeech( (await context.db.read('master').getAnswer(context.db.read('speechKey'))) ) + "." );
        context.say.push( escapeSpeech( (await context.db.read('master').getAnnotation(context.db.read('speechKey'))) ) + "." );
        switch(pickSayString(context, 4, 3)) {
          case 0:
            context.say.push( "Let's go again." );
            break;
          case 1:
            context.say.push( "One more time!" );
            break;
          default:
            context.say.push( "Keep going!" );
            break;
        }
        context.db.write('score', context.db.read('score') + 1);
        context.nextState = 'generateRandomSpeech';
      }
      else {
        switch(pickSayString(context, 5, 13)) {
          case 0:
            context.say.push( "<say-as interpret-as='interjection'>aw man.</say-as>" );
            break;
          case 1:
            context.say.push( "Come on, this one's easy." );
            break;
          case 2:
            context.say.push( "Wrong!" );
            break;
          case 3:
            context.say.push( "<say-as interpret-as='interjection'>aww applesauce.</say-as>" + " That isn't it." );
            break;
          case 4:
            context.say.push( "Correct! ... " + "<say-as interpret-as='interjection'>just kidding.</say-as>" );
            break;
          case 5:
            context.say.push( "<say-as interpret-as='interjection'>nuh uh.</say-as>" );
            break;
          case 6:
            context.say.push( "Nice Try!" );
            break;
          case 7:
            context.say.push( "You really don't know this?" );
            break;
          case 8:
            context.say.push( "Uncultured swine." );
            break;
          case 9:
            context.say.push( "Yikes." );
            break;
          case 10:
            context.say.push( "L. O. L." );
            break;
          case 11:
            context.say.push( "Are you even trying?" );
            break;
          default:
            context.say.push( "Are you serious?" );
            break;
        }
        switch(pickSayString(context, 6, 2)) {
          case 0:
            context.say.push( "Here it is again." );
            break;
          default:
            context.say.push( "Try again!" );
            break;
        }
        context.nextState = 'askForRepeat';
      }
      break;
    }
    case 'WHAT_BLANK_IS_THIS': {
      if (context.slots.blank) {
        context.say.push( escapeSpeech( (await context.db.read('master').getAccent(context.db.read('speechKey'))) ) + "." );
        context.nextState = 'waitForAnswer';
      }
      else {
        context.say.push( "Wrong!" );
        context.say.push( "Here it is again." );
        context.nextState = 'askForRepeat';
      }
      break;
    }
    case 'AMAZON.NextIntent': {
      context.card = {
        title: escapeSpeech( (await context.db.read('master').getAnswer(context.db.read('speechKey'))) ),
        content: escapeSpeech( (await context.db.read('master').getAnnotation(context.db.read('speechKey'))) ),
      };
      context.say.push( "the answer was, " + escapeSpeech( (await context.db.read('master').getAnswer(context.db.read('speechKey'))) ) + "." );
      context.say.push( escapeSpeech( (await context.db.read('master').getAnnotation(context.db.read('speechKey'))) ) + "." );
      switch(pickSayString(context, 7, 2)) {
        case 0:
          context.say.push( "Let's go again." );
          break;
        default:
          context.say.push( "One more time." );
          break;
      }
      context.nextState = 'generateRandomSpeech';
      break;
    }
    case 'REPEAT_THE_BLANKTHREE': {
      if (context.slots.blankthree) {
        context.say.push( escapeSpeech( context.db.read('currentHint') ) + "." );
        context.nextState = 'waitForAnswer';
      }
      else {
        context.say.push( "Wrong! Here it is again." );
        context.nextState = 'askForRepeat';
      }
      break;
    }
    case 'LIST_THE_BLANKFOUR': {
      if (context.slots.blankfour) {
        context.say.push( "You can ask me for help by saying, Alexa, help. Or ask me to repeat the phrase by saying, repeat." );
        context.say.push( "If you want to know the accent, ask me, Alexa, what accent is this." );
        context.say.push( "You can give up on a phrase by saying, Alexa, I give up." );
      }
      context.nextState = 'askForAnswer';
      break;
    }
    case 'AMAZON.RepeatIntent': {
      context.nextState = 'askForRepeat';
      break;
    }
    case 'AMAZON.HelpIntent': {
      context.nextState = 'giveHint';
      break;
    }
    case 'AMAZON.StopIntent': {
      context.nextState = 'goodbye';
      break;
    }
    case 'AMAZON.CancelIntent': {
      if (context.db.read('gameInProgress') === true) {
        context.say.push( "Are you sure you want to quit?" );
        context.nextState = 'confirmGoodbye';
      }
      else {
        context.nextState = 'goodbye';
      }
      break;
    }
  }
  return true;
};
exitState.waitForAnswer = async function(context) {
};

enterState.confirmGoodbye = async function(context) {
};
processIntents.confirmGoodbye = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, false) ) { return true; }
      context.say.push( "Sorry, I didn't understand. Are you sure you want to quit?" );
      context.nextState = 'confirmGoodbye';
      break;
    }
    case 'AMAZON.YesIntent': {
      context.nextState = 'goodbye';
      break;
    }
    case 'AMAZON.NoIntent': {
      context.say.push( "Okay, let's go back to the game." );
      context.nextState = 'waitForAnswer';
      break;
    }
  }
  return true;
};
exitState.confirmGoodbye = async function(context) {
};

enterState.goodbye = async function(context) {
  context.db.write('gameInProgress', false);
  context.shouldEndSession = true;
};
processIntents.goodbye = async function(context, runOtherwise) {
  switch( context.intent ) {
    default: {
      if ( await processIntents.global(context, true) ) { return true; }
      break;
    }
  }
  return true;
};
exitState.goodbye = async function(context) {
};





})( __languages['default'] );

