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
let cartaChiamataCorrente = null; // Sarà il valore (es. "Asso", "3")
let idChiamante = null;
let idSocio = null;
let maniGiocate = 0;
let indiceTurnoGiocata = 0; 
let carteSulTavolo = [];     
let puntiGiocatori = {};     

io.on('connection', (socket) => {
    console.log('Giocatore connesso:', socket.id);

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

    socket.on('scelta_briscola', (dati) => {
        idChiamante = socket.id;
        idSocio = null; 
        maniGiocate = 0; 
        briscolaCorrente = dati.seme;
        // Puliamo il valore della carta chiamata (es. da "Asso di Coppe" a "1")
        // Assicurati che il client mandi dati.valoreCarta come numero
        cartaChiamataCorrente = dati.carta; 
        
        indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === socket.id);
        carteSulTavolo = [];

        io.emit('inizio_partita_sincronizzato', {
            seme: dati.seme,
            carta: dati.carta,
            prossimoTurnoId: socket.id,
            giocatori: giocatoriConnessi
        });
    });

    socket.on('gioca_carta', (dati) => {
        if (socket.id !== giocatoriConnessi[indiceTurnoGiocata].id) return;

        // LOGICA SCOPERTA SOCIO
        // Se la carta giocata ha lo stesso valore di quella chiamata e il seme è la briscola scelta
        if (dati.carta.valore == cartaChiamataCorrente && dati.carta.seme == briscolaCorrente) {
            idSocio = socket.id;
            console.log("Socio identificato:", idSocio);
        }

        carteSulTavolo.push({
            giocatoreId: socket.id,
            carta: dati.carta 
        });

        indiceTurnoGiocata = (indiceTurnoGiocata + 1) % giocatoriConnessi.length;

        io.emit('aggiorna_tavolo', {
            giocatoreId: socket.id,
            carta: dati.carta,
            prossimoTurnoId: giocatoriConnessi[indiceTurnoGiocata].id
        });

        if (carteSulTavolo.length === 5) {
            setTimeout(risolviPresa, 2000); 
        }
    });

    socket.on('disconnect', () => {
        giocatoriConnessi = giocatoriConnessi.filter(g => g.id !== socket.id);
        io.emit('aggiorna_giocatori', giocatoriConnessi.length);
        // Reset partita se qualcuno esce? Opzionale
    });
});

function risolviPresa() {
    if (carteSulTavolo.length < 5) return;

    const semeIniziale = carteSulTavolo[0].carta.seme;
    let vincente = carteSulTavolo[0];

    for (let i = 1; i < carteSulTavolo.length; i++) {
        const sfidante = carteSulTavolo[i];
        if (sfidante.carta.seme === briscolaCorrente && vincente.carta.seme !== briscolaCorrente) {
            vincente = sfidante;
        } 
        else if (sfidante.carta.seme === vincente.carta.seme) {
            if (confrontaCarte(sfidante.carta.valore, vincente.carta.valore)) {
                vincente = sfidante;
            }
        }
    }

    const idVincitorePresa = vincente.giocatoreId;
    const puntiTotaliMano = carteSulTavolo.reduce((acc, c) => acc + (c.carta.punti || 0), 0);

    puntiGiocatori[idVincitorePresa] += puntiTotaliMano;
    indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === idVincitorePresa);
    maniGiocate++;
    
    io.emit('fine_mano', {
        vincitoreId: idVincitorePresa,
        puntiAggiornati: puntiGiocatori,
        prossimoTurnoId: idVincitorePresa 
    });

    carteSulTavolo = [];

    // --- CONTROLLO FINE PARTITA ---
    if (maniGiocate === 8) {
        setTimeout(inviaRisultatiFinali, 1500);
    }
}

function inviaRisultatiFinali() {
    const nomeChiamante = giocatoriConnessi.find(g => g.id === idChiamante)?.nome || "Ignoto";
    const nomeSocio = giocatoriConnessi.find(g => g.id === idSocio)?.nome || "Non uscito";
    
    const puntiChiamanti = puntiGiocatori[idChiamante] + (idSocio && idSocio !== idChiamante ? puntiGiocatori[idSocio] : 0);
    const puntiAltri = 120 - puntiChiamanti;

    io.emit('partita_finita', {
        chiamante: nomeChiamante,
        socio: nomeSocio,
        puntiChiamanti: puntiChiamanti,
        puntiAltri: puntiAltri,
        vittoriaChiamanti: puntiChiamanti > 60,
        classifica: puntiGiocatori
    });
}

function confrontaCarte(val1, val2) {
    const gerarchia = { 1: 12, 3: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 2: 3 };
    return (gerarchia[val1] || 0) > (gerarchia[val2] || 0);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});