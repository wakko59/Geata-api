const { pool } = require("./index");

module.exports = async () => {
  if (pool) await pool.end();
};
