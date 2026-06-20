// services/queue.js
// Simple in-memory job queue with PostgreSQL persistence

const { pool } = require('../db');

class JobQueue {
  constructor() {
    this.processing = false;
    this.handlers = {};
    this.interval = null;
  }

  register(jobType, handler) {
    this.handlers[jobType] = handler;
  }

  async enqueue(jobType, payload) {
    try {
      const res = await pool.query(`
        INSERT INTO job_queue (job_type, payload) VALUES ($1, $2) RETURNING id
      `, [jobType, JSON.stringify(payload)]);
      console.log(`📋 Job enqueued: ${jobType} [${res.rows[0].id}]`);
      this.process(); // trigger immediate processing
      return res.rows[0].id;
    } catch (err) {
      console.error('Queue enqueue error:', err.message);
    }
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        // Pick up oldest pending job
        const res = await pool.query(`
          UPDATE job_queue SET status = 'processing', attempts = attempts + 1
          WHERE id = (
            SELECT id FROM job_queue WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
          )
          RETURNING *
        `);
        if (!res.rows.length) break;

        const job = res.rows[0];
        const handler = this.handlers[job.job_type];

        if (!handler) {
          await pool.query(`UPDATE job_queue SET status = 'failed', error = $1, processed_at = now() WHERE id = $2`,
            [`No handler for job type: ${job.job_type}`, job.id]);
          continue;
        }

        try {
          await handler(job.payload);
          await pool.query(`UPDATE job_queue SET status = 'completed', processed_at = now() WHERE id = $1`, [job.id]);
          console.log(`✅ Job completed: ${job.job_type} [${job.id}]`);
        } catch (err) {
          console.error(`❌ Job failed: ${job.job_type} [${job.id}]`, err.message);
          await pool.query(`UPDATE job_queue SET status = 'failed', error = $1, processed_at = now() WHERE id = $2`,
            [err.message, job.id]);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  start(intervalMs = 10000) {
    this.interval = setInterval(() => {
      this.process().catch(err => {
        console.warn('⚠️  Job queue cycle error (DB may be unreachable):', err.message);
      });
    }, intervalMs);
    console.log(`🔄 Job queue started (polling every ${intervalMs / 1000}s)`);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }
}

const jobQueue = new JobQueue();
module.exports = jobQueue;
