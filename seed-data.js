const http = require('http');

const players = [
  { nickname: '知识王者', avatar: 0, score: 100, timeInSeconds: 45 },
  { nickname: '学霸小明', avatar: 2, score: 90, timeInSeconds: 60 },
  { nickname: '答题达人', avatar: 5, score: 80, timeInSeconds: 55 },
  { nickname: '努力选手', avatar: 7, score: 70, timeInSeconds: 90 },
  { nickname: '勇敢牛牛', avatar: 3, score: 60, timeInSeconds: 120 },
  { nickname: '新手上路', avatar: 9, score: 50, timeInSeconds: 150 },
];

function submitPlayer(player) {
  const data = JSON.stringify(player);
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/submit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        console.log(`✅ ${player.nickname}: ${body}`);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  for (const p of players) {
    await submitPlayer(p);
  }
  console.log('\n🎉 所有测试数据已提交!');
}

main();
