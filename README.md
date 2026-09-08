# Console GAF/GAM — projet (structure à plat, comme ton repo)

Tous les fichiers sont à la RACINE (pas de dossier src/), pour coller à ton dépôt GitHub actuel.

## Le fichier à éditer : App.jsx
Tout en haut : le **PANNEAU DE CONFIGURATION** (codes, divisions, catégories, groupes, horaires…).
1. Modifie le bloc CONFIG.
2. **Augmente `CONFIG_VERSION`** (1 -> 2 -> 3…) — sinon les changements ne s'appliquent pas.
3. Commit sur GitHub → Vercel redéploie tout seul (~1 min).

## Fichiers
- App.jsx        → l'appli + le panneau de config
- store.js       → connexion Supabase (ne pas toucher)
- main.jsx, index.html, vite.config.js, package.json → structure Vite
- supabase/schema.sql → table à créer dans Supabase (déjà fait chez toi)
- .env.example   → rappel des variables (déjà mises dans Vercel)

## Variables Vercel (déjà configurées chez toi)
- VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (clé publishable)
