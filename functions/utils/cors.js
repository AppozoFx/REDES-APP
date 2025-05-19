// functions/utils/cors.js
const cors = require("cors")({
  origin: [
    "http://localhost:3000",
    "https://www.redesmyd.com",
    "https://redesmyd.com",
  ],
});

module.exports = cors;