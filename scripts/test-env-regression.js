const assert = require('assert');

console.log('Running Config & Environment Regression Tests...');

// 1. Dev mode allows fallback
process.env.NODE_ENV = 'development';
delete process.env.JWT_SECRET;
let env = require('../config/env');
assert.strictEqual(env.NODE_ENV, 'development');
console.log('✓ Dev fallback allowed');

// 2. Production without secret throws
process.env.NODE_ENV = 'production';
delete process.env.JWT_SECRET;
let threw = false;
try {
  delete require.cache[require.resolve('../config/env')];
  require('../config/env');
} catch(e) {
  threw = true;
  assert(e.message.includes('FATAL ERROR'));
}
assert(threw, 'Should throw if JWT_SECRET missing in production');
console.log('✓ Production missing secret rejected');

// 3. Production with known weak secret throws
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'your_super_secret_jwt_key_here_change_in_production';
threw = false;
try {
  delete require.cache[require.resolve('../config/env')];
  require('../config/env');
} catch(e) {
  threw = true;
  assert(e.message.includes('known insecure'));
}
assert(threw, 'Should throw if known weak secret used in production');
console.log('✓ Production weak secret rejected');

// 4. Production with short secret throws
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'short_secret_123';
threw = false;
try {
  delete require.cache[require.resolve('../config/env')];
  require('../config/env');
} catch(e) {
  threw = true;
  assert(e.message.includes('minimum 32 characters'));
}
assert(threw, 'Should throw if secret too short in production');
console.log('✓ Production short secret rejected');

// 5. Production localhost MONGO_URI throws
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'a_very_strong_production_secret_key_that_is_32_chars_long';
process.env.MONGO_URI = 'mongodb://localhost:27017/school_management_db';
threw = false;
try {
  delete require.cache[require.resolve('../config/env')];
  require('../config/env');
} catch(e) {
  threw = true;
  assert(e.message.includes('localhost'));
}
assert(threw, 'Should throw if MONGO_URI is localhost in production');
console.log('✓ Production localhost MONGO_URI rejected');

// 6. Production valid config succeeds
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'a_very_strong_production_secret_key_that_is_32_chars_long';
process.env.MONGO_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/school_management_db';
delete require.cache[require.resolve('../config/env')];
env = require('../config/env');
assert.strictEqual(env.NODE_ENV, 'production');
console.log('✓ Production valid config accepted');

// Reset to development
process.env.NODE_ENV = 'development';
delete require.cache[require.resolve('../config/env')];
require('../config/env');

console.log('✅ All 6 Environment & Config Regression Tests Passed!');
