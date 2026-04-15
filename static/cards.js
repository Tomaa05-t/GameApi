// js/cards.js - Versione Completa con Punti
const semiInfo = [
    { nome: 'bastoni', suffix: 'bast' },
    { nome: 'spade', suffix: 'spade' },
    { nome: 'coppe', suffix: 'coppe' }, 
    { nome: 'ori', suffix: 'ori' }     
];

// Funzione per calcolare i punti della briscola
function calcolaPunti(valore) {
    if (valore === 1) return 11;
    if (valore === 3) return 10;
    if (valore === 10) return 4;
    if (valore === 9) return 3;
    if (valore === 8) return 2;
    return 0;
}

const mazzo = [];

for (let seme of semiInfo) {
    for (let valore = 1; valore <= 10; valore++) {
        mazzo.push({
            seme: seme.nome,
            valore: valore,
            punti: calcolaPunti(valore), // AGGIUNTO: Fondamentale per il server!
            id: `${valore}_${seme.suffix}`, 
            img: `carte/${seme.nome}/${valore}_${seme.suffix}.png` 
        });
    }
}