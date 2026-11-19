const { Queue } = require('bullmq');
const { connection } = require('./redis.connection');
const prefix = process.env.EMAIL_QUEUE_PREFIX || 'erp-email:';

const queue = connection ? new Queue('erp-email-delivery', {
  connection,
  prefix,
  defaultJobOptions: {
    // Mongo owns retry count and scheduling; each BullMQ job is one attempt.
    attempts: 1,
    removeOnComplete: true,
    // The reconciler can re-add the deterministic ID after this failed job is removed.
    removeOnFail: true,
  },
}) : null;

async function enqueueDelivery(deliveryId) {
  if (!queue) throw new Error('Email queue is not configured');
  return queue.add('deliver-email', { deliveryId }, {
    jobId: `delivery-${deliveryId}`,
  });
}

async function closeQueue() {
  if (queue) await queue.close();
}

module.exports = { closeQueue, enqueueDelivery, prefix, queue };
