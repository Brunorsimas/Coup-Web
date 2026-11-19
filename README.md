# Coup - Jogo Web Multiplayer

Implementação web do jogo de cartas **Coup** com multiplayer em tempo real via Firebase.

## 🎮 Funcionalidades

- ✅ Regras completas do Coup original
- ✅ Multiplayer em tempo real (Firebase Realtime Database)
- ✅ Criação de salas com código de 6 caracteres
- ✅ Sistema de blefe e contestação
- ✅ Todas as 5 classes: Duque, Assassino, Capitão, Embaixadora, Condessa
- ✅ 6 ações: Renda, Ajuda Externa, Golpe, Assassinato, Roubo, Troca
- ✅ Interface responsiva (desktop/mobile)
- ✅ Painel de regras expansível (balão no canto)
- ✅ Log de jogo em tempo real
- ✅ Tema original (Resistência/Dystopia)

## 🚀 Como Configurar

### 1. Firebase Setup

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Crie um novo projeto
3. Ative **Realtime Database**:
   - Build → Realtime Database → Create database
   - Escolha localização
   - **Modo de teste** (para desenvolvimento)
4. Em **Project Settings** → **General** → **Your apps** → **Web app** (</>):
   - Registre o app
   - Copie as configurações

### 2. Configure o Firebase

Edite `firebase-config.js` e substitua:

```javascript
const firebaseConfig = {
    apiKey: "SUA_API_KEY_AQUI",
    authDomain: "SEU_PROJETO.firebaseapp.com",
    databaseURL: "https://SEU_PROJETO-default-rtdb.firebaseio.com",
    projectId: "SEU_PROJETO",
    storageBucket: "SEU_PROJETO.appspot.com",
    messagingSenderId: "SEU_SENDER_ID",
    appId: "SEU_APP_ID"
};
```

### 3. Regras do Database (Firestore/Realtime)

No Firebase Console → Realtime Database → Rules:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['code', 'creator', 'maxPlayers', 'status', 'players'])"
      }
    }
  }
}
```

> **⚠️ Produção**: Use regras mais restritivas com autenticação.

### 4. Artes das Cartas

**⚠️ IMPORTANTE**: As artes originais do Coup (La Mame Games / Indie Boards & Cards) são **protegidas por direitos autorais**. Não podem ser baixadas/distribuídas legalmente.

O jogo já inclui **SVGs originais animados** na pasta `assets/`:
- `duke.svg`, `assassin.svg`, `captain.svg`, `ambassador.svg`, `countess.svg`

Estes são artes criadas do zero, inspiradas no tema, **livres de royalties**. Se quiser usar artes oficiais:
1. Compre o jogo físico
2. Escaneie suas próprias cartas para uso **estritamente pessoal**
3. Coloque em `assets/` como `.png` (300x420px)
4. Atualize `getCharacterImage()` em `app.js`:
   ```javascript
   return `assets/${character}.png`;
   ```

> **Não distribua** versões com artes oficiais escaneadas.

## 🎯 Como Jogar

### Criar Sala
1. Abra `index.html` no navegador (via servidor local)
2. Digite seu nome
3. Escolha número de jogadores (2-6)
4. **Opcional**: Marque **Regras da Casa** (veja abaixo)
5. Clique "Criar Sala"
6. Compartilhe o código de 6 letras com amigos

### Entrar na Sala
1. Clique na aba "Entrar na Sala"
2. Digite seu nome e o código da sala
3. Clique "Entrar na Sala"

### Iniciar Jogo
- Apenas o criador vê o botão "Iniciar Jogo"
- Mínimo 2 jogadores
- **2 jogadores = 3 cartas cada** (variante oficial)
- **3+ jogadores = 2 cartas cada** (padrão)

### Durante o Jogo
- **Sua vez**: Painel de ações aparece abaixo das cartas
- **Ações principais** (suas cartas): Botões azuis
- **Blefe** (outras cartas): Botões dourados com label "BLEFE"
- **Alvos**: Clique no oponente para selecionar
- **Contestação/Bloqueio**: Modal aparece automaticamente
- **Perder influência**: Clique na carta para revelar
- **Rodada**: Contador no log (afeta regra "Sem Blefe 1ª Rodada")

### Regras
- Clique no balão 📜 no canto inferior direito
- Painel slide-up com regras completas, tabela de ações e **regras da casa**

### Regras da Casa (Novas!)
Ao criar a sala, o criador pode ativar:
| Regra | Efeito |
|-------|--------|
| **Must Coup at 10+** | Com 10+ moedas, só pode dar Golpe |
| **Sem Blefe 1ª Rodada** | Primeira rodada: só ações com cartas reais |
| **Revelar Todas na Morte** | Eliminado mostra todas as cartas restantes |
| **Assassino = 2💰** | Assassinato custa 2 moedas (mais agressivo) |
| **Duque = 3💰** | Ajuda Externa do Duque dá 3 moedas |

Badge ⚙️ no topo mostra regras ativas durante a partida.

## 📁 Estrutura de Arquivos

```
coup-game/
├── index.html          # HTML principal
├── styles.css          # Estilos completos
├── firebase-config.js  # Configuração Firebase
├── game-logic.js       # Lógica do jogo (regras, ações, validações)
├── room-manager.js     # Gerenciamento de salas (Firebase)
├── app.js              # Controlador principal (UI, eventos)
├── assets/             # Imagens das cartas (coloque aqui)
└── README.md           # Este arquivo
```

## 🔧 Desenvolvimento

### Servidor Local (Recomendado)

```bash
# Python 3
python -m http.server 8000

# Node.js (http-server)
npx http-server

# VS Code: Live Server extension
```

Acesse `http://localhost:8000`

### Testar Multiplayer
1. Abra em duas janelas/abas diferentes
2. Ou use navegadores diferentes (Chrome + Firefox)
3. Ou dispositivos diferentes na mesma rede

## 🐛 Problemas Conhecidos

| Problema | Solução |
|----------|---------|
| "Firebase não configurado" | Edite `firebase-config.js` com suas credenciais |
| Sala não encontrada | Verifique código (maiúsculas, sem espaços) |
| Imagens não carregam | Verifique pasta `assets/` ou use placeholders |
| Travou no "Aguardando jogadores" | Verifique console (F12) para erros Firebase |

## 📝 Regras Implementadas

### Personagens e Habilidades
| Personagem | Ação | Bloqueia |
|------------|------|----------|
| Duque | Ajuda Externa (+2 moedas) | Ajuda Externa |
| Assassino | Assassinato (3 moedas, mata 1) | - |
| Capitão | Roubo (rouba 2 moedas) | Roubo |
| Embaixadora | Troca (troca cartas com baralho) | Roubo, Troca |
| Condessa | - | Assassinato |

### Ações Básicas (sem carta)
- **Renda**: +1 moeda (não bloqueável)
- **Golpe**: 7 moedas, força perda de influência (não bloqueável)

### Fluxo de Contestação
1. Jogador declara ação (pode blefar)
2. Outros podem: **Bloquear** (se tem carta) ou **Contestar**
3. Se contestado: quem errou perde influência
4. Se bloqueado: autor pode contestar o bloqueio
5. Perde influência → revela carta → compra nova do baralho

## 🎨 Personalização

### Temas
Modifique variáveis CSS em `styles.css`:
```css
:root {
    --bg-dark: #1a1a2e;
    --accent-gold: #e9b44c;
    --accent-red: #e94c4c;
    /* ... */
}
```

### Novas Cartas/Ações
1. Adicione em `game-logic.js`: `CHARACTERS`, `ACTIONS`, `ACTION_BLOCKERS`
2. Adicione ícones/imagens
3. Atualize UI em `app.js`

## 📄 Licença

Código: MIT License
Artes do Coup: © La Mame Games / Indie Boards & Cards (use apenas para estudo)

## 🤝 Contribuição

PRs bem-vindos! Sugestões:
- Animações de cartas virando
- Sons/Efeitos
- Modo espectador
- Histórico de partidas
- Chat na sala
- IA para jogar sozinho