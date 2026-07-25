const localtunnel = require('localtunnel');

async function startTunnel() {
    try {
        console.log('Starting localtunnel connection...');
        const tunnel = await localtunnel({ port: 3000 });
        
        console.log('--------------------------------------------------');
        console.log(`Your public online URL is: ${tunnel.url}`);
        console.log('--------------------------------------------------');
        
        tunnel.on('close', () => {
            console.log('Tunnel connection closed. Restarting in 5 seconds...');
            setTimeout(startTunnel, 5000);
        });
        
        tunnel.on('error', (err) => {
            console.error('Tunnel error:', err);
        });
    } catch (err) {
        console.error('Failed to start tunnel. Retrying in 5 seconds...', err.message);
        setTimeout(startTunnel, 5000);
    }
}

startTunnel();

// Keep the Node.js process alive
setInterval(() => {}, 1000 * 60 * 60);
