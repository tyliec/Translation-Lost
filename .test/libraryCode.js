var litexa = exports.litexa;
if (typeof(litexa) === 'undefined') { litexa = {}; }
if (typeof(litexa.modulesRoot) === 'undefined') { litexa.modulesRoot = process.cwd(); }

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