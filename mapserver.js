var googleapis = require('googleapis'),
  OAuth2Client = googleapis.OAuth2Client,
  redis = require('redis'),
  redis_client = redis.createClient(),
  url = require("url");

var gaApi = googleapis.discover('analytics', 'v3');

var http = require('http');
var _ = require('underscore');

var clientId = '';
var clientSecret = '';
var port = 1337;
var redirectUrl = 'http://localhost:' + port + '/oauth_response';
var oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);

var access_tokens_invalid = false;
var access_token = '';
var refresh_token = '';

var siteId = '664630';
var refreshInterval = 30000;

// Current data to send to arduino
var gaData = [];

// Plucked data for significant countries
var significant = [
  'United Kingdom'
];

var presort_data = {
  'United Kingdom':     { colour : 0, sort_index: 0 },
  'Western Europe':     { colour : 0, sort_index: 1 },
  'Western Asia':       { colour : 0, sort_index: 2 },
  'Western Africa':     { colour : 0, sort_index: 3 },
  'Northern Europe':    { colour : 0, sort_index: 4 },
  'Northern America':   { colour : 0, sort_index: 5 },
  'Southern Europe':    { colour : 0, sort_index: 6 },
  'Southern Asia':      { colour : 0, sort_index: 7 },
  'Southern Africa':    { colour : 0, sort_index: 8 },
  'South-Eastern Asia': { colour : 0, sort_index: 9 },
  'South America':      { colour : 0, sort_index: 5 },
  'Northern Africa':    { colour : 0, sort_index: 11 },
  'Middle Africa':      { colour : 0, sort_index: 12 },
  'Melanesia':          { colour : 0, sort_index: 13 },
  'Eastern Europe':     { colour : 0, sort_index: 14 },
  'Eastern Asia':       { colour : 0, sort_index: 15 },
  'Eastern Africa':     { colour : 0, sort_index: 16 },
  'Central America':    { colour : 0, sort_index: 17 },
  'Caribbean':          { colour : 0, sort_index: 18 },
  'Australasia':        { colour : 0, sort_index: 19 },
  '(not set)':          { colour : 0, sort_index: 20 },
  'Polynesia':          { colour : 0, sort_index: 21 }
};


/**
 * REDIS
 */

redis_client.on("error", function(err) {
  console.log("REDIS ERROR: " + err);
});

function get_saved_access_tokens() {
  redis_client.get("oauth_details", function(err, reply) {

    if (reply) {
      var obj = JSON.parse( reply.toString() );

      if(obj.hasOwnProperty('access_token')) {
        access_token = obj.access_token;
        refresh_token = obj.refresh_token;
      }

      oauth2Client.credentials = obj;

      access_tokens_invalid = false;

      return oauth2Client.credentials;
    }
  });

  access_tokens_invalid = true;

}

function set_access_tokens(tokens) {
  access_token = tokens.access_token;
  refresh_token = tokens.refresh_token;

  redis_client.set("oauth_details", JSON.stringify(tokens), function(err, reply) {
    if(err) throw err;

    console.log('REDIS: Saved access tokens');
  });

  oauth2Client.credentials = tokens;
}

/**
 * OAUTH CALLBACKS
 */

function redirect_for_auth(res) {
  var redirect_url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/analytics.readonly'
  });

  console.log(redirect_url);

  res.writeHead(301, {'Location': redirect_url});
  res.end('Redirecting');
}

/**
 * GOOGLE ANALYTICS
 */

var getData = function(err, client) {
  var params = {
    ids: 'ga:' + siteId,
    'start-date': '2010-08-18',
    'end-date': '2013-08-20',
    metrics: 'ga:pageviews',
    dimensions: 'ga:subContinent,ga:country' //ga:continent,
  };

  client
    .analytics.data.ga.get(params)
    .withAuthClient(oauth2Client)
    .execute(function (err, response) {
      if(err) throw err;

      gaData = response.rows;
  });
}

/**
 * HTTP SERVER
 */

http.createServer(function(req, res) {
  if (access_tokens_invalid === true) {
    console.log('INVALID ACCESS TOKEN')
    access_tokens_invalid = false;
    return redirect_for_auth(res);
  }

  // Parse request url

  var code, url_parts = url.parse(req.url, true),
    req_path = url_parts.pathname;

  if (req_path === '/oauth_response') {
    console.log("RESPONSE TIME");
    code = url_parts.query.code;

    oauth2Client.getToken(code, function(err, tokens) {
      console.log(tokens);
      set_access_tokens(tokens);
    });

    res.writeHead(301, {'Location': 'http://localhost:' + port});
    res.end('Redirecting again');
    return;
  }

  // From here down is the standard response

  var outString = '';
  var totals = {};
  var subContinents = {};

  for (var i = gaData.length - 1; i >= 0; i--) {
    if(significant.indexOf(gaData[i][1]) !== -1) {
      totals[gaData[i][1]] = gaData[i][2];
    } else {
      if(!!subContinents[gaData[i][0]]) {
        subContinents[gaData[i][0]] += parseInt(gaData[i][2]);
      } else {
        subContinents[gaData[i][0]] = parseInt(gaData[i][2]);
      }
    }
  };

  // Add the subcontinents to the significant items
  for (i in subContinents) {
    totals[i] = subContinents[i];
  };

  // Avg (Mean)
  var count = _.keys(totals).length;
  var sum = _.reduce(totals, function(memo, num){ return memo + parseInt(num); }, 0);

  var mean = sum / count;

  // Max and Min
  var minMax = [Number.MAX_VALUE, 0];

  _.each(totals, function(value, key, list) {

    minMax[0] = Math.min(minMax[0], value);
    minMax[1] = Math.max(minMax[1], value);
  }, 0);

  //var min = minMax[0];
  var max = minMax[1];

  // Calculate a new value for the area to map to led colour
  _.each(totals, function(value, key, list) {
    if(!_.has(presort_data, key)) {
      presort_data[key] = { colour : 0, sort_index: 100 }
    }

    if(value == max) {
      presort_data[key]['colour'] = 3; // yellow
    } else if(value < mean) {
      presort_data[key]['colour'] = 2; // red
    } else {
      presort_data[key]['colour'] = 1; // green
    }
  });

  var sorted_data = _.toArray(presort_data);
  sorted_data = _.sortBy(presort_data, function(row) {
    return row['sort_index'];
  });

  _.each(sorted_data, function(value, key, list) {
    outString += value['colour'];
  });

  res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length' : outString.length});
  res.end(outString);

}).listen(port, '0.0.0.0');;


/**
 * SETUP
 */

redis_client.on("connect", get_saved_access_tokens);

var timer = setInterval(function(){
  gaApi.execute(getData);
}, refreshInterval);
