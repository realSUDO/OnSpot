import 'dotenv/config';
import { kafkaClient } from './kafka-client.js';
import fs from 'node:fs/promises';

const consumer = kafkaClient.consumer({ groupId: 'db-processor' });

await consumer.connect();
await consumer.subscribe({ topic: 'location-updates', fromBeginning: false });

console.log('[DB Processor] Started, consuming location-updates');

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const data = JSON.parse(message.value.toString());
    const timestamp = new Date().toISOString();
    
    // Simulate database write by appending to a log file
    const logEntry = `${timestamp} | User: ${data.name || data.id} | Lat: ${data.latitude} | Lng: ${data.longitude}\n`;
    await fs.appendFile('./location-history.log', logEntry);
    
    console.log(`[DB] Stored location for ${data.name || data.id}`);
  },
});
