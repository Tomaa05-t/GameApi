const GameState = {
    partitaId: null,
    fase: 'LOBBY',          // Fasi: LOBBY, ATTESA, ASTA, GIOCANDO
    giocatoriConnessi: 0,   // Quanti utenti ci sono nella stanza
    maxGiocatori: 5,        // Numero necessario per iniziare
    mioTurno: false,
    giocatori: [],          // Nomi o ID degli altri partecipanti
    miaMano: [],   
    tavolo: [],    
    punteggioAsta: 60,
    briscola: null,
    cartaChiamata: null     // Il numero chiamato (es. "Asso")
};

function renderGame() {
    const areaLobby = document.getElementById('area-lobby');
    const tavoloGioco = document.getElementById('tavolo-gioco');
    const interfacciaAsta = document.getElementById('interfaccia-asta');
    const areaAttesa = document.getElementById('area-attesa'); // Assicurati di avere questo ID nell'HTML

    // 1. Reset: Nascondi tutto per evitare sovrapposizioni
    if (areaLobby) areaLobby.classList.add('d-none');
    if (tavoloGioco) tavoloGioco.classList.add('d-none');
    if (interfacciaAsta) interfacciaAsta.classList.add('d-none');
    if (areaAttesa) areaAttesa.classList.add('d-none');

    // 2. Gestione Fasi
    switch (GameState.fase) {
        case 'LOBBY':
            if (areaLobby) areaLobby.classList.remove('d-none');
            break;

        case 'ATTESA':
            if (areaAttesa) {
                areaAttesa.classList.remove('d-none');
                // Aggiorna il contatore grafico nell'HTML
                const countEl = document.getElementById('count-giocatori');
                if (countEl) countEl.innerText = GameState.giocatoriConnessi;
            }
            break;

        case 'ASTA':
            if (tavoloGioco) tavoloGioco.classList.remove('d-none');
            if (interfacciaAsta) interfacciaAsta.classList.remove('d-none');
            // Mostriamo le carte per decidere cosa chiamare
            disegnaManoReale(GameState.miaMano); 
            disegnaAvversari();
            break;

        case 'GIOCANDO':
            if (tavoloGioco) tavoloGioco.classList.remove('d-none');
            // Nasconde l'asta se era ancora aperta
            if (interfacciaAsta) interfacciaAsta.classList.add('d-none');
            disegnaManoReale(GameState.miaMano);
            disegnaAvversari();
            break;
    }
}