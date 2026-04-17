const io = require('socket.io-client');
const axios = require('axios');

// Config
const API_URL = 'http://localhost:8788';
const SOCKET_URL = 'http://localhost:8788';
const CALLBACK_URL = `${API_URL}/suno-callback`;

async function run() {
  console.log('--- Test Flow: Trigger -> Callback -> Socket -> Client ---');

  // 1. Connect Socket
  console.log('[1] Connecting socket...');
  const socket = io(SOCKET_URL, {
    path: '/socket',
    transports: ['websocket'],
    reconnection: true,
  });

  const taskPromise = new Promise((resolve, reject) => {
    socket.on('connect', () => {
      console.log('[1] Socket connected:', socket.id);
    });
    
    socket.on('suno:track', (data) => {
      console.log('[4] Socket received suno:track:', data);
      resolve(data);
    });

    socket.on('suno:error', (data) => {
      console.error('[4] Socket received suno:error:', data);
      reject(data);
    });
  });

  // 2. Simulate Trigger (User calls generate)
  const fakeTaskId = 'test-task-' + Date.now();
  console.log('[2] Simulating trigger (skipping real API call), taskId:', fakeTaskId);

  // 3. Simulate Suno Callback (Suno calls our webhook)
  setTimeout(async () => {
    console.log('[3] Simulating Suno callback to:', CALLBACK_URL);
    try {
      const payload = {
        code: 200,
        msg: 'ok',
        data: {
          callbackType: 'complete',
          task_id: fakeTaskId,
          data: [
            {
              audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
              cover: 'https://via.placeholder.com/150',
              title: 'Test Flow Track',
              stream_audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
            }
          ]
        }
      };
      
      const res = await axios.post(CALLBACK_URL, payload);
      console.log('[3] Callback posted, status:', res.status);
    } catch (e) {
      console.error('[3] Callback failed:', e.message);
    }
  }, 2000);

  // Wait for socket event
  try {
    const result = await taskPromise;
    console.log('[SUCCESS] Flow complete. Track received.');
    if (result.task_id === fakeTaskId) {
      console.log('Task ID matches!');
    } else {
      console.warn('Task ID mismatch!');
    }
  } catch (e) {
    console.error('[FAILURE] Flow failed:', e);
  } finally {
    socket.disconnect();
  }
}

run();
