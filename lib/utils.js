const miniget = require('miniget');


/**
 * Extract string inbetween another.
 *
 * @param {string} haystack
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
exports.between = (haystack, left, right) => {
  let pos;
  if (left instanceof RegExp) {
    const match = haystack.match(left);
    if (!match) { return ''; }
    pos = match.index + match[0].length;
  } else {
    pos = haystack.indexOf(left);
    if (pos === -1) { return ''; }
    pos += left.length;
  }
  haystack = haystack.slice(pos);
  pos = haystack.indexOf(right);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(0, pos);
  return haystack;
};


/**
 * Get a number from an abbreviated number string.
 *
 * @param {string} string
 * @returns {number}
 */
exports.parseAbbreviatedNumber = string => {
  const match = string
    .replace(',', '.')
    .replace(' ', '')
    .match(/([\d,.]+)([MK]?)/);
  if (match) {
    let [, num, multi] = match;
    num = parseFloat(num);
    return Math.round(multi === 'M' ? num * 1000000 :
      multi === 'K' ? num * 1000 : num);
  }
  return null;
};

// Char-codes for efficient comparison
const OPEN_CURLY_CODE = '{'.charCodeAt(0);
const OPEN_SQUARE_CODE = '['.charCodeAt(0);
const CLOSE_CURLY_CODE = '}'.charCodeAt(0);
const CLOSE_SQUARE_CODE = ']'.charCodeAt(0);
const QUOTE_CODE = '"'.charCodeAt(0);
const ESCAPE_CODE = '\\'.charCodeAt(0);

/**
 * Seek past a JSON string. Assumes that idx is first character of string.
 * Returns the index after end-quote
 *
 * @param {string} str
 * @param {number} idx
 * @returns {number} index after end-quote
 */
function seekPastString(str, idx) {
  let done = false;
  while (!done && idx < str.length) {
    switch (str.charCodeAt(idx++)) {
      // Ignore escaped character
      case ESCAPE_CODE:
        idx++;
        break;
      case QUOTE_CODE:
        done = true;
        break;
      default:
    }
  }

  if (!done) {
    throw new Error(`Failed to seek past string. End quote was not found before end of body`);
  }

  return idx;
}

/**
 * Match begin and end braces of input JSON, return only json
 *
 * @param {string} mixedJson
 * @param {number} startIdx
 * @returns {string}
*/
exports.cutAfterJSON = (mixedJson, startIdx = 0) => {
  switch (mixedJson.charCodeAt(startIdx)) {
    case OPEN_CURLY_CODE:
    case OPEN_SQUARE_CODE:
      break;
    default:
      throw new Error(`Can't cut unsupported JSON (need to begin with [ or { ) but got: ${mixedJson[0]}`);
  }

  // Current open brackets to be closed
  const stack = [mixedJson.charCodeAt(startIdx)];

  let i = startIdx + 1;
  while (stack.length && i < mixedJson.length) {
    switch (mixedJson.charCodeAt(i++)) {
      case QUOTE_CODE:
        i = seekPastString(mixedJson, i);
        break;
      case OPEN_CURLY_CODE:
        stack.push(OPEN_CURLY_CODE);
        break;
      case OPEN_SQUARE_CODE:
        stack.push(OPEN_SQUARE_CODE);
        break;
      case CLOSE_CURLY_CODE: {
        const bracket = stack.pop();
        if (bracket !== OPEN_CURLY_CODE) {
          throw new Error(`JSON malformatted - '}' received but should have been ']'`);
        }
        break;
      }
      case CLOSE_SQUARE_CODE: {
        const bracket = stack.pop();
        if (bracket !== OPEN_SQUARE_CODE) {
          throw new Error(`JSON malformatted - ']' received but should have been '}'`);
        }
        break;
      }
      default:
    }
  }

  // All brackets have been closed, thus end of JSON is reached
  if (stack.length === 0) {
    // Return the cut JSON
    return mixedJson.slice(startIdx, i);
  }

  // We ran through the whole string and ended up with an unclosed bracket
  throw Error("Can't cut unsupported JSON (no matching closing bracket found)");
};


/**
 * Checks if there is a playability error.
 *
 * @param {Object} player_response
 * @param {Array.<string>} statuses
 * @param {Error} ErrorType
 * @returns {!Error}
 */
exports.playError = (player_response, statuses, ErrorType = Error) => {
  let playability = player_response && player_response.playabilityStatus;
  if (playability && statuses.includes(playability.status)) {
    return new ErrorType(playability.reason || (playability.messages && playability.messages[0]));
  }
  return null;
};

/**
 * Does a miniget request and calls options.requestCallback if present
 *
 * @param {string} url the request url
 * @param {Object} options an object with optional requestOptions and requestCallback parameters
 * @param {Object} requestOptionsOverwrite overwrite of options.requestOptions
 * @returns {miniget.Stream}
 */
exports.exposedMiniget = (url, options = {}, requestOptionsOverwrite) => {
  const req = miniget(url, requestOptionsOverwrite || options.requestOptions);
  if (typeof options.requestCallback === 'function') options.requestCallback(req);
  return req;
};

/**
 * Temporary helper to help deprecating a few properties.
 *
 * @param {Object} obj
 * @param {string} prop
 * @param {Object} value
 * @param {string} oldPath
 * @param {string} newPath
 */
exports.deprecate = (obj, prop, value, oldPath, newPath) => {
  Object.defineProperty(obj, prop, {
    get: () => {
      console.warn(`\`${oldPath}\` will be removed in a near future release, ` +
        `use \`${newPath}\` instead.`);
      return value;
    },
  });
};


// Check for updates.
const pkg = require('../package.json');
const UPDATE_INTERVAL = 1000 * 60 * 60 * 12;
exports.lastUpdateCheck = 0;
exports.checkForUpdates = () => {
  if (!process.env.YTDL_NO_UPDATE && !pkg.version.startsWith('0.0.0-') &&
    Date.now() - exports.lastUpdateCheck >= UPDATE_INTERVAL) {
    exports.lastUpdateCheck = Date.now();
    return miniget('https://api.github.com/repos/fent/node-ytdl-core/releases/latest', {
      headers: { 'User-Agent': 'ytdl-core' },
    }).text().then(response => {
      if (JSON.parse(response).tag_name !== `v${pkg.version}`) {
        console.warn('\x1b[33mWARNING:\x1B[0m ytdl-core is out of date! Update with "npm install ytdl-core@latest".');
      }
    }, err => {
      console.warn('Error checking for updates:', err.message);
      console.warn('You can disable this check by setting the `YTDL_NO_UPDATE` env variable.');
    });
  }
  return null;
};
