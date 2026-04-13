// js/cards.js - Versione Aggiornata per percorso 'carte/'

const semiInfo = [
    { nome: 'bastoni', suffix: 'bast' },
    { nome: 'spade', suffix: 'spade' },
    { nome: 'coppe', suffix: 'coppe' }, 
    { nome: 'ori', suffix: 'ori' }     
];

const mazzo = [];

// Generiamo il mazzo completo (40 carte)
for (let seme of semiInfo) {
    for (let valore = 1; valore <= 10; valore++) {
        mazzo.push({
            seme: seme.nome,
            valore: valore,
            id: `${valore}_${seme.suffix}`, 
            // Percorso esatto: carte/bastoni/1_bast.png
            img: `carte/${seme.nome}/${valore}_${seme.suffix}.png` 
        });
    }
}

// Esportiamo il mazzo se necessario (o lo lasciamo globale)
// window.mazzoCompleto = mazzo;