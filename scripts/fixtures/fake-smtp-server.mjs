import net from 'node:net';

/**
 * A loopback SMTP relay that records what it receives.
 *
 * The server speaks just enough SMTP for the mail client: greeting, EHLO, AUTH,
 * MAIL FROM, RCPT TO, DATA and QUIT. Nothing leaves the machine, and no
 * message is delivered anywhere.
 */
export async function startFakeSmtp(t) {
  const messages = [];
  const auths = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    let authMode = null;
    let current = null;
    let dataMode = false;
    socket.write('220 localhost synthetic SMTP\r\n');
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      if (dataMode) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        current.data = buffer.slice(0, end);
        messages.push(current); current = null; dataMode = false; buffer = buffer.slice(end + 5);
        socket.write('250 2.0.0 accepted\r\n');
      }
      let index;
      while (!dataMode && (index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const upper = line.toUpperCase();
        if (authMode === 'user') { current = { user: line, password: '' }; authMode = 'password'; socket.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (authMode === 'password') { auths.push({ user: current.user, password: line }); current = null; authMode = null; socket.write('235 2.7.0 authenticated\r\n'); continue; }
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
        else if (upper.startsWith('AUTH PLAIN ')) {
          const parts = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0');
          auths.push({ user: parts[1] ?? '', password: parts[2] ?? '' }); socket.write('235 2.7.0 authenticated\r\n');
        } else if (upper === 'AUTH LOGIN') { authMode = 'user'; socket.write('334 VXNlcm5hbWU6\r\n'); }
        else if (upper.startsWith('MAIL FROM:')) {
          current ??= { from: '', to: [], data: '' };
          current.from = line.slice(10).replace(/^<|>$/g, ''); socket.write('250 OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) { current.to.push(line.slice(8).replace(/^<|>$/g, '')); socket.write('250 OK\r\n'); }
        else if (upper === 'DATA') { dataMode = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (upper === 'RSET') { current = null; socket.write('250 OK\r\n'); }
        else if (upper === 'QUIT') { socket.end('221 bye\r\n'); }
        else socket.write('250 OK\r\n');
      }
    };
    socket.on('data', onData);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { port: address.port, messages, auths };
}
