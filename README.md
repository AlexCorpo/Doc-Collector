# LENS · Document Index (OpenRouter + Brave Search)

## Stack

- **Next.js 14** — App Router, TypeScript
- **OpenRouter** — Claude via API compatible OpenAI
- **Brave Search API** — recherche web (gratuit jusqu'à 2000 req/mois)

## Installation

```bash
npm install
cp .env.example .env.local
```

Éditer `.env.local` :

```
OPENROUTER_API_KEY=sk-or-...     # openrouter.ai → Keys
BRAVE_SEARCH_API_KEY=BSA...      # brave.com/search/api → Free plan
```

```bash
npm run dev
```

Ouvrir http://localhost:3000

## Obtenir les clés

### OpenRouter
1. Aller sur [openrouter.ai](https://openrouter.ai)
2. Créer un compte → Keys → Create Key
3. Copier la clé `sk-or-...`

### Brave Search API (gratuit)
1. Aller sur [brave.com/search/api](https://brave.com/search/api)
2. Choisir le plan **Free** (2000 requêtes/mois)
3. Créer un compte → API Keys → Copier la clé

## Déploiement Vercel

1. Pousser sur GitHub
2. Importer sur vercel.com
3. Ajouter `OPENROUTER_API_KEY` et `BRAVE_SEARCH_API_KEY` dans Environment Variables
4. Deploy
