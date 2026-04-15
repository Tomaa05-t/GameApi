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
app.use(express.static(path.join(__dirname, 'static')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- STATO DELLA PARTITA ---
let giocatoriConnessi = [];
let giocatoriInAsta = []; 
let indiceTurnoAsta = 0; 

// Variabili di Gioco
let briscolaCorrente = null;
let cartaChiamataCorrente = null;
let indiceTurnoGiocata = 0; 
let carteSulTavolo = [];    
let puntiGiocatori = {};    

io.on('connection', (socket) => {
    console.log('Giocatore connesso:', socket.id);

    // 1. GESTIONE INGRESSO
    socket.on('unisciti_partita', (nome) => {
        if (giocatoriConnessi.length < 5) {
            if (!giocatoriConnessi.find(g => g.id === socket.id)) {
                giocatoriConnessi.push({ 
                    id: socket.id, 
                    nome: nome || `Giocatore ${giocatoriConnessi.length + 1}` 
                });
                puntiGiocatori[socket.id] = 0; 
            }
            io.emit('aggiorna_giocatori', giocatoriConnessi.length);

            if (giocatoriConnessi.length === 5) {
                indiceTurnoAsta = 0;
                giocatoriInAsta = giocatoriConnessi.map(g => g.id);
                io.emit('inizia_asta', { prossimoGiocatoreId: giocatoriInAsta[0] });
            }
        }
    });

    // 2. GESTIONE ASTA
    socket.on('mossa_asta', (dati) => {
        if (socket.id !== giocatoriInAsta[indiceTurnoAsta]) return;

        if (dati.tipo === 'PASSO') {
            giocatoriInAsta.splice(indiceTurnoAsta, 1);
            if (indiceTurnoAsta >= giocatoriInAsta.length) indiceTurnoAsta = 0;
        } else {
            indiceTurnoAsta = (indiceTurnoAsta + 1) % giocatoriInAsta.length;
        }

        if (giocatoriInAsta.length === 1) {
            const vincitoreId = giocatoriInAsta[0];
            io.emit('fine_asta', { 
                vincitoreId: vincitoreId, 
                vincitoreNome: giocatoriConnessi.find(g => g.id === vincitoreId).nome 
            });
        } else {
            io.emit('aggiorna_asta', {
                ultimoValore: dati.valore,
                indice: dati.indice,
                prossimoGiocatoreId: giocatoriInAsta[indiceTurnoAsta]
            });
        }
    });

    // 3. SCELTA BRISCOLA E INIZIO
    socket.on('scelta_briscola', (dati) => {
        briscolaCorrente = dati.seme;
        cartaChiamataCorrente = dati.carta;
        
        // Il vincitore dell'asta è il primo a giocare
        indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === socket.id);
        carteSulTavolo = [];

        io.emit('inizio_partita_sincronizzato', {
            seme: dati.seme,
            carta: dati.carta,
            prossimoTurnoId: socket.id,
            giocatori: giocatoriConnessi // Fondamentale per la mappatura dei posti nel client
        });
    });

    // 4. GIOCATA CARTA
    socket.on('gioca_carta', (dati) => {
        if (socket.id !== giocatoriConnessi[indiceTurnoGiocata].id) return;

        carteSulTavolo.push({
            giocatoreId: socket.id,
            carta: dati.carta 
        });

        // Avanza il turno in senso orario
        indiceTurnoGiocata = (indiceTurnoGiocata + 1) % giocatoriConnessi.length;

        io.emit('aggiorna_tavolo', {
            giocatoreId: socket.id,
            carta: dati.carta,
            prossimoTurnoId: giocatoriConnessi[indiceTurnoGiocata].id
        });

        if (carteSulTavolo.length === 5) {
            setTimeout(() => {
                risolviPresa();
            }, 2000); 
        }
    });

    socket.on('disconnect', () => {
        giocatoriConnessi = giocatoriConnessi.filter(g => g.id !== socket.id);
        io.emit('aggiorna_giocatori', giocatoriConnessi.length);
    });
});

// --- LOGICA DI CALCOLO PRESA ---
function risolviPresa() {
    if (carteSulTavolo.length < 5) return;

    const semeIniziale = carteSulTavolo[0].carta.seme;
    let vincente = carteSulTavolo[0];

    for (let i = 1; i < carteSulTavolo.length; i++) {
        const sfidante = carteSulTavolo[i];
        
        // Se lo sfidante gioca briscola e il vincente attuale no -> vince lo sfidante
        if (sfidante.carta.seme === briscolaCorrente && vincente.carta.seme !== briscolaCorrente) {
            vincente = sfidante;
        } 
        // Se entrambi sono briscola o entrambi sono seme iniziale -> vince il valore più alto
        else if (sfidante.carta.seme === vincente.carta.seme) {
            if (confrontaCarte(sfidante.carta.valore, vincente.carta.valore)) {
                vincente = sfidante;
            }
        }
    }

    const idVincitorePresa = vincente.giocatoreId;
    const puntiTotaliMano = carteSulTavolo.reduce((acc, c) => acc + (c.carta.punti || 0), 0);

    // Assegna i punti
    puntiGiocatori[idVincitorePresa] += puntiTotaliMano;

    // Chi vince la mano inizia la prossima: aggiorniamo l'indice del turno
    indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === idVincitorePresa);
    
    io.emit('fine_mano', {
        vincitoreId: idVincitorePresa,
        puntiAggiornati: puntiGiocatori,
        prossimoTurnoId: idVincitorePresa 
    });

    carteSulTavolo = [];
}

function confrontaCarte(val1, val2) {
    // Gerarchia Briscola: Asso(12), 3(11), Re(10), Cavallo(9), Fante(8), 7, 6, 5, 4, 2
    const gerarchia = { 1: 12, 3: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 2: 3 };
    return (gerarchia[val1] || 0) > (gerarchia[val2] || 0);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});