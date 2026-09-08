# Console de compétition GAF/GAM — mise en ligne

Front React (Vite) + backend **Supabase** (gratuit) pour les données partagées en temps réel.
L'appli est identique à ton prototype v22 ; seule la couche de stockage a été branchée sur Supabase.

## 1. Créer le backend Supabase (5 min)
1. Va sur https://supabase.com → « New project » (gratuit).
2. Dans le projet : menu **SQL Editor** → colle le contenu de `supabase/schema.sql` → **Run**.
3. Menu **Project Settings → API** : copie **Project URL** et la clé **anon public**.

## 2. Configurer le projet
1. Copie `.env.example` en `.env` et colle tes deux valeurs :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyxxxx
   ```
2. Installe et lance en local pour tester :
   ```
   npm install
   npm run dev
   ```
   Ouvre l'URL affichée sur deux appareils/onglets → la synchro passe par Supabase.

## 3. Mettre en ligne
Choisis UNE option :

**Vercel (le plus simple)**
- Pousse le dossier sur un dépôt GitHub, puis https://vercel.com → « Import Project ».
- Ajoute les 2 variables d'env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) dans Vercel.
- Deploy. Tu obtiens une URL publique (à mettre dans le QR de l'écran, onglet Réglages).

**Netlify** : identique (build command `npm run build`, publish dir `dist`, mêmes variables d'env).

**Ton hébergement OVH** : `npm run build` → envoie le contenu du dossier `dist/` par FTP dans ton espace web.

## Notes importantes
- **Multi-appareils réel** : oui, via Supabase. L'appli rafraîchit toutes les 4 s (tu peux activer le temps réel Supabase plus tard en décommentant la ligne du schema).
- **Concurrence à 150 (point #1)** : cette version stocke encore chaque « bloc » (scores, roster…) sous une clé unique. C'est bon pour un vrai test multi-appareils, mais pour être 100 % sûr à 20+ juges simultanés il faut passer les **notes en une ligne par case** (table dédiée). C'est l'étape 2, que je peux te préparer.
- **Sécurité** : la policy SQL autorise l'accès anonyme (pratique pour tester). À restreindre avec l'auth Supabase avant un usage officiel.
- **Tailwind** : chargé via CDN (ok pour tester). Pour la prod, configure Tailwind en PostCSS.
