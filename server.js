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

// --- DATABASE TEMPORANEO ---
let partite = {}; 

io.on('connection', (socket) => {
    console.log('Connesso:', socket.id);

    // Invia la lista delle partite disponibili al nuovo connesso
    socket.emit('aggiorna_lista_partite', ottieniListaLobby());

    // 1. CREAZIONE PARTITA
    socket.on('crea_partita', (nomeCreatore) => {
        const numeroPartite = Object.keys(partite).length;
        if (numeroPartite >= 5) { // Alzato il limite a 5
            return socket.emit('errore', 'Troppe partite attive nel server.');
        }

        const roomID = `room_${Date.now()}`;
        partite[roomID] = {
            id: roomID,
            creatore: nomeCreatore,
            giocatori: [{ id: socket.id, nome: nomeCreatore }],
            stato: 'LOBBY',
            giocatoriInAsta: [],
            indiceTurnoAsta: 0,
            briscolaCorrente: null,
            cartaChiamataCorrente: null,
            idChiamante: null,
            idSocio: null,
            maniGiocate: 0,
            indiceTurnoGiocata: 0,
            carteSulTavolo: [],
            puntiGiocatori: { [socket.id]: 0 }
        };

        socket.join(roomID);
        socket.roomID = roomID;
        
        socket.emit('partita_creata', roomID);
        io.emit('aggiorna_lista_partite', ottieniListaLobby());
    });

    // 2. UNIRSI A UNA PARTITA
    socket.on('unisciti_a_partita', (dati) => {
        const { roomID, nomePlayer } = dati;
        const p = partite[roomID];

        if (p && p.giocatori.length < 5 && p.stato === 'LOBBY') {
            p.giocatori.push({ id: socket.id, nome: nomePlayer });
            p.puntiGiocatori[socket.id] = 0;
            socket.join(roomID);
            socket.roomID = roomID;

            io.to(roomID).emit('aggiorna_giocatori', p.giocatori.length);
            io.emit('aggiorna_lista_partite', ottieniListaLobby());

            if (p.giocatori.length === 5) {
                avviaPartitaReale(roomID);
            }
        }
    });

    // 3. LOGICA ASTA (Sincronizzata con Nomi)
    socket.on('mossa_asta', (dati) => {
        const p = partite[socket.roomID];
        if (!p) return;

        // Verifica turno
        const idCorrente = p.giocatoriInAsta[p.indiceTurnoAsta];
        if (socket.id !== idCorrente) return;

        if (dati.tipo === 'PASSO') {
            p.giocatoriInAsta.splice(p.indiceTurnoAsta, 1);
            if (p.indiceTurnoAsta >= p.giocatoriInAsta.length) p.indiceTurnoAsta = 0;
        } else {
            p.indiceTurnoAsta = (p.indiceTurnoAsta + 1) % p.giocatoriInAsta.length;
        }

        if (p.giocatoriInAsta.length === 1) {
            const vincitoreId = p.giocatoriInAsta[0];
            const vincitore = p.giocatori.find(g => g.id === vincitoreId);
            
            io.to(p.id).emit('fine_asta', { 
                vincitoreId: vincitoreId, 
                vincitoreNome: vincitore ? vincitore.nome : "Sconosciuto" 
            });
        } else {
            const prossimoId = p.giocatoriInAsta[p.indiceTurnoAsta];
            const prossimoNome = p.giocatori.find(g => g.id === prossimoId).nome;

            io.to(p.id).emit('aggiorna_asta', {
                ultimoValore: dati.valore,
                indice: dati.indice,
                prossimoGiocatoreId: prossimoId,
                prossimoGiocatoreNome: prossimoNome
            });
        }
    });

    // 4. SCELTA BRISCOLA
// Cerca questa parte nel server.js
socket.on('scelta_briscola', (dati) => {
    const p = partite[socket.roomID];
    if (!p) return;

    p.stato = 'GIOCANDO'; // Cambia lo stato sul server
    p.idChiamante = socket.id;
    p.briscolaCorrente = dati.seme;
    p.cartaChiamataCorrente = dati.carta;
    
    // Il primo a giocare è chi ha chiamato (il vincitore dell'asta)
    p.indiceTurnoGiocata = p.giocatori.findIndex(g => g.id === socket.id);

    // IMPORTANTE: Usa io.to(p.id) per svegliare tutti i giocatori!
    io.to(p.id).emit('inizio_partita_sincronizzato', {
        seme: p.briscolaCorrente,
        carta: p.cartaChiamataCorrente,
        prossimoTurnoId: socket.id,
        prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome,
        giocatori: p.giocatori // Invia la lista per mappare i posti
    });
});

    // 5. GIOCATA CARTA
    socket.on('gioca_carta', (dati) => {
        const p = partite[socket.roomID];
        if (!p || socket.id !== p.giocatori[p.indiceTurnoGiocata].id) return;

        // Controllo Socio (quando viene giocata la carta chiamata)
        if (dati.carta.valore == p.cartaChiamataCorrente && dati.carta.seme == p.briscolaCorrente) {
            p.idSocio = socket.id;
            console.log("Il socio è stato trovato:", socket.id);
        }

        p.carteSulTavolo.push({ giocatoreId: socket.id, carta: dati.carta });
        p.indiceTurnoGiocata = (p.indiceTurnoGiocata + 1) % p.giocatori.length;

        io.to(p.id).emit('aggiorna_tavolo', {
            giocatoreId: socket.id,
            carta: dati.carta,
            prossimoTurnoId: p.giocatori[p.indiceTurnoGiocata].id,
            prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome
        });

        if (p.carteSulTavolo.length === 5) {
            setTimeout(() => risolviPresa(p.id), 1500);
        }
    });

    socket.on('disconnect', () => {
        const rID = socket.roomID;
        if (partite[rID]) {
            partite[rID].giocatori = partite[rID].giocatori.filter(g => g.id !== socket.id);
            if (partite[rID].giocatori.length === 0) {
                delete partite[rID];
            } else {
                io.to(rID).emit('aggiorna_giocatori', partite[rID].giocatori.length);
            }
            io.emit('aggiorna_lista_partite', ottieniListaLobby());
        }
    });
});

// --- FUNZIONI UTILI ---

function ottieniListaLobby() {
    return Object.values(partite)
        .filter(p => p.stato === 'LOBBY')
        .map(p => ({ id: p.id, creatore: p.creatore, n: p.giocatori.length }));
}

function avviaPartitaReale(roomID) {
    const p = partite[roomID];
    p.stato = 'ASTA';
    const mazzo = creaMazzo();
    
    // Distribuzione carte
    p.giocatori.forEach((g, i) => {
        const mano = mazzo.slice(i * 8, (i + 1) * 8);
        io.to(g.id).emit('ricevi_carte', mano);
    });

    // Avvio Asta
    setTimeout(() => {
        p.giocatoriInAsta = p.giocatori.map(g => g.id);
        const primoId = p.giocatoriInAsta[0];
        const primoNome = p.giocatori.find(g => g.id === primoId).nome;
        
        io.to(roomID).emit('inizia_asta', { 
            prossimoGiocatoreId: primoId,
            prossimoGiocatoreNome: primoNome 
        });
    }, 1500);
}

function risolviPresa(roomID) {
    const p = partite[roomID];
    if (!p) return;

    let vincente = p.carteSulTavolo[0];
    const semeBase = vincente.carta.seme;

    for (let i = 1; i < p.carteSulTavolo.length; i++) {
        const sfidante = p.carteSulTavolo[i];
        // Se lo sfidante gioca briscola e il vincente no
        if (sfidante.carta.seme === p.briscolaCorrente && vincente.carta.seme !== p.briscolaCorrente) {
            vincente = sfidante;
        } 
        // Se giocano entrambi lo stesso seme (briscola o seme di mano)
        else if (sfidante.carta.seme === vincente.carta.seme) {
            if (confrontaCarte(sfidante.carta.valore, vincente.carta.valore)) {
                vincente = sfidante;
            }
        }
    }

    const puntiMano = p.carteSulTavolo.reduce((acc, c) => acc + (c.carta.punti || 0), 0);
    p.puntiGiocatori[vincente.giocatoreId] += puntiMano;
    p.indiceTurnoGiocata = p.giocatori.findIndex(g => g.id === vincente.giocatoreId);
    p.maniGiocate++;

    io.to(roomID).emit('fine_mano', {
        vincitoreId: vincente.giocatoreId,
        puntiAggiornati: p.puntiGiocatori,
        prossimoTurnoId: vincente.giocatoreId,
        prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome
    });

    p.carteSulTavolo = [];
    if (p.maniGiocate === 8) {
        setTimeout(() => inviaRisultatiFinali(roomID), 2000);
    }
}

function inviaRisultatiFinali(roomID) {
    const p = partite[roomID];
    if (!p) return;

    const puntiChiamanti = p.puntiGiocatori[p.idChiamante] + (p.idSocio && p.idSocio !== p.idChiamante ? p.puntiGiocatori[p.idSocio] : 0);
    const nomiChiamanti = p.giocatori.find(g => g.id === p.idChiamante)?.nome + 
                          (p.idSocio && p.idSocio !== p.idChiamante ? " e " + p.giocatori.find(g => g.id === p.idSocio)?.nome : "");

    io.to(roomID).emit('partita_finita', {
        chiamante: nomiChiamanti,
        socio: p.idSocio ? p.giocatori.find(g => g.id === p.idSocio)?.nome : "Nessuno",
        puntiChiamanti,
        puntiAltri: 120 - puntiChiamanti,
        vittoriaChiamanti: puntiChiamanti > 60
    });

    delete partite[roomID];
    io.emit('aggiorna_lista_partite', ottieniListaLobby());
}

function creaMazzo() {
    const semi = ['bastoni', 'spade', 'coppe', 'ori'];
    const suffix = { 'bastoni': 'bast', 'spade': 'spade', 'coppe': 'coppe', 'ori': 'ori' };
    let mazzo = [];
    for (let s of semi) {
        for (let v = 1; v <= 10; v++) {
            mazzo.push({
                seme: s, valore: v,
                punti: (v === 1 ? 11 : v === 3 ? 10 : v === 10 ? 4 : v === 9 ? 3 : v === 8 ? 2 : 0),
                img: `carte/${s}/${v}_${suffix[s]}.png`
            });
        }
    }
    return mazzo.sort(() => Math.random() - 0.5);
}

function confrontaCarte(val1, val2) {
    const gerarchia = { 1: 12, 3: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 2: 3 };
    return (gerarchia[val1] || 0) > (gerarchia[val2] || 0);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});