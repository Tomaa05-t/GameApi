import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// --- STATO DELLA PARTITA (Variabili Globali) ---
let giocatoriConnessi = [];
let giocatoriInAsta = []; 
let indiceTurnoAsta = 0; 
let briscolaCorrente = null;
let cartaChiamataCorrente = null;

io.on('connection', (socket) => {
    console.log('Un giocatore si è connesso:', socket.id);

    // 1. INGRESSO NELLA LOBBY
    socket.on('unisciti_partita', (nome) => {
        if (giocatoriConnessi.length < 5) {
            if (!giocatoriConnessi.find(g => g.id === socket.id)) {
                giocatoriConnessi.push({ 
                    id: socket.id, 
                    nome: nome || `Giocatore ${giocatoriConnessi.length + 1}` 
                });
            }
            io.emit('aggiorna_giocatori', giocatoriConnessi.length);

            if (giocatoriConnessi.length === 5) {
                indiceTurnoAsta = 0;
                giocatoriInAsta = giocatoriConnessi.map(g => g.id);
                
                io.emit('inizia_asta', {
                    prossimoGiocatoreId: giocatoriInAsta[0],
                    giocatori: giocatoriConnessi
                });
            }
        }
    });

    // 2. LOGICA DELL'ASTA
    socket.on('mossa_asta', (dati) => {
        if (socket.id !== giocatoriInAsta[indiceTurnoAsta]) return;

        if (dati.tipo === 'PASSO') {
            giocatoriInAsta.splice(indiceTurnoAsta, 1);
            if (indiceTurnoAsta >= giocatoriInAsta.length) {
                indiceTurnoAsta = 0;
            }
        } else {
            indiceTurnoAsta = (indiceTurnoAsta + 1) % giocatoriInAsta.length;
        }

        if (giocatoriInAsta.length === 1) {
            const vincitoreId = giocatoriInAsta[0];
            const vincitoreNome = giocatoriConnessi.find(g => g.id === vincitoreId).nome;
            
            io.emit('fine_asta', { 
                vincitoreId: vincitoreId,
                vincitoreNome: vincitoreNome,
                valoreFinale: dati.valore 
            });
        } else {
            io.emit('aggiorna_asta', {
                ultimoValore: dati.valore,
                indice: dati.indice, // Passa l'indice ricevuto dal client
                prossimoGiocatoreId: giocatoriInAsta[indiceTurnoAsta]
            });
        }
    });

    // --- 3. AGGIUNTA FONDAMENTALE: SCELTA BRISCOLA ---
    // Questo riceve la scelta dal vincitore e la "spara" a tutti per iniziare il gioco
    socket.on('scelta_briscola', (dati) => {
        briscolaCorrente = dati.seme;
        cartaChiamataCorrente = dati.carta;

        console.log(`Partita Iniziata! Seme: ${dati.seme}, Carta: ${dati.carta}`);

        // Comunica a TUTTI di passare alla fase "GIOCANDO"
        io.emit('inizio_partita_sincronizzato', {
            seme: dati.seme,
            carta: dati.carta
        });
    });

    // 4. DISCONNESSIONE
    socket.on('disconnect', () => {
        giocatoriConnessi = giocatoriConnessi.filter(g => g.id !== socket.id);
        giocatoriInAsta = giocatoriInAsta.filter(id => id !== socket.id);
        io.emit('aggiorna_giocatori', giocatoriConnessi.length);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});