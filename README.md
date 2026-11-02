# Arena Grilles — gestion des compétitions GAF / GAM

Cette branche **conserve l'interface historique** (organisateur, juges, juge supérieur, coachs, superviseur, speaker, public) et fiabilise son fonctionnement sur plusieurs appareils.

## Améliorations

- Notes par gymnaste/agrès enregistrées **atomiquement** en base (plus de réécriture concurrente de toute la liste).
- Inscriptions, modifications, suppressions, réclamations et présence avec opérations atomiques.
- Supabase Realtime : actualisation immédiate via WebSocket, relecture périodique si Realtime n'est pas disponible, synchronisation au retour d'onglet.
- En cas d'erreur réseau, l'application affiche un avertissement ; elle ne fait plus passer une erreur de lecture pour une liste vide ni une erreur d'écriture pour une sauvegarde réussie.
- L'initialisation ne réinitialise plus les réglages dès que la version du code change.
- Tailwind compilé localement (sans dépendance au CDN), mise en page resserrée sur mobile, métadonnées pour l'ajout à l'écran d'accueil.

## Déploiement (ATTENTION : ORDRE IMPORTANT)

1. Faire **une sauvegarde de la table `public.kv`**, notamment `ffg10:scores`, `ffg10:roster`, `ffg10:config`.
2. Dans Supabase → SQL Editor, appliquer `supabase/migrations/20261102_atomic_multi_device.sql` **avant** de déployer ce code. La fonction `arena_apply_mutation` doit exister et la publication Realtime doit contenir `public.kv`.
3. Exécuter `supabase/tests/atomic_smoke.sql` dans SQL Editor. Le script se termine par **ROLLBACK** et conserve les données existantes.
4. Configurer les variables Vercel `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (clé publique uniquement).
5. Installer/build : `npm install`, `npm run build`, puis déployer sur Vercel (ou serveur hébergeant le dossier `dist/`).
6. Faire un essai **sur une compétition fictive** avant d'utiliser la plateforme avec des résultats officiels : deux juges sur deux navigateurs écrivent en même temps sur un même agrès et vérifient que les deux notes restent présentes. Tester ensuite Chrome, Firefox, Safari iPhone/iPad, tablette Android, projection speaker et retour réseau après perte du Wi-Fi.

**Ne pas fusionner cette branche tant que la migration SQL et les tests multidevices n'ont pas été effectués.** La branche de travail est destinée à une pull request en brouillon.

## Limites et sécurité AVANT usage officiel

Cette version corrige des **conflits de données**, mais **pas encore** la sécurité des droits :
les codes des rôles se trouvent actuellement dans du JavaScript public. La table partagée `kv` ne dispose pas ici d'une séparation sécurisée entre juges, coachs et visiteurs. Les mots de passe de l'interface **ne suffisent pas comme authentification serveur**. Il faut mettre en place Supabase Auth, rôles définis côté serveur, Row Level Security (RLS), des permissions de validation distinctes et un journal d'audit avant une compétition officielle. Ne pas rendre publiques des données privées.

Les écritures de configuration et les imports en masse utilisent encore un remplacement complet du document. Éviter de faire simultanément plusieurs modifications administratives. L'accès réseau est nécessaire pour **enregistrer** des notes : le mode hors-ligne est volontairement en lecture seule et affiche un avertissement. L'installation de la PWA ne garantit pas un mode hors-ligne autonome.

## Structure

- `App.jsx` : UI GAF/GAM historique et synchronisation.
- `store.js` : client Supabase, lecture/écriture, abonnement Realtime et mutation RPC.
- `supabase/migrations/...` : fonction SQL transactionnelle.
- `styles.css`, `tailwind.config.js`, `postcss.config.js` : CSS local.
- `public/` : manifest et icône.
- `.env.example` : variables requises.

## Guide de secours

Si la bannière « connexion en cours / mode de secours » reste affichée, vérifier le Wi-Fi, les règles d'accès à `kv`, la publication Supabase Realtime et les variables Vercel. Si une saisie retourne « migration SQL requise », appliquer la migration. **Ne pas réinitialiser la compétition pour résoudre un problème de connexion.**
