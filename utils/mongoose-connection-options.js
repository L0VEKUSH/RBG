'use strict';

function getMongooseConnectionOptions(nodeEnv) {
  const allowAutomaticSetup = nodeEnv !== 'production';
  return {
    autoIndex: allowAutomaticSetup,
    autoCreate: allowAutomaticSetup,
  };
}

function configureMongooseForEnvironment(mongoose, nodeEnv) {
  if (!mongoose || typeof mongoose.set !== 'function') {
    throw new TypeError('A Mongoose instance is required');
  }

  const options = getMongooseConnectionOptions(nodeEnv);
  mongoose.set('autoIndex', options.autoIndex);
  mongoose.set('autoCreate', options.autoCreate);
  return options;
}

module.exports = {
  configureMongooseForEnvironment,
  getMongooseConnectionOptions,
};
