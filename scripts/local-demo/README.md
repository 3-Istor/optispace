# Démonstration locale Facility Manager

Ces scripts PowerShell démarrent OptiSpace sur Windows avec une base SQLite dédiée et un profil Facility Manager de démonstration. Les observations et réservations sont simulées. Le serveur et le frontend écoutent sur `127.0.0.1`, aux ports 5301 et 5300.

Depuis la racine du dépôt, préparer les dépendances une première fois.

```powershell
python -m venv backend/.venv
& ./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd --prefix frontend ci
```

Le fichier `frontend/package-lock.json` est versionné pour permettre cette installation reproductible. Utiliser le manifeste et le verrou du même ref. Les dépendances Python sont épinglées dans `backend/requirements.txt`.

Lancer la démonstration.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Start-OptiSpace.ps1
```

La commande complète est nécessaire lorsque PowerShell utilise la politique `Restricted`, comme sur l'hôte vérifié. `-ExecutionPolicy Bypass` s'applique uniquement au processus lancé et ne modifie pas la politique Windows enregistrée. Le serveur doit rester actif pour que l'adresse locale réponde ; un lien vers `127.0.0.1` ne le démarre pas.

Ouvrir `http://127.0.0.1:5300/admin`. Le chargement initial prépare huit semaines terminées de données simulées. Le tableau de bord propose **Générer la synthèse** pour une salle et **Générer le rapport** pour les salles et horaires choisis, avec téléchargement PDF. Choisir **7 jours** dans la synthèse permet de consulter les observations historiques de la démo.

Le lanceur utilise la clé Groq configurée par l’environnement ou les fichiers `.env` du backend. À défaut, une saisie masquée enregistre une clé chiffrée pour le compte Windows courant dans `.groq-key.xml`. Les démarrages suivants rechargent cette valeur. Le serveur doit être lancé depuis ce même compte Windows. Pour remplacer la clé enregistrée, exécuter le script de configuration.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Set-OptiSpaceGroq.ps1
```

Les fichiers de données, journaux et clé chiffrée sont générés à côté des scripts et exclus de Git. Le lanceur annonce son URL lorsqu’il est prêt. Garder le terminal ouvert pendant l’essai. `Ctrl+C` arrête la démonstration.

## Variantes de test

Groq est utilisé automatiquement pour le rapport et la synthèse courte. `-ReportProvider groq` reste accepté pour les anciennes commandes ; `gemini` n'est plus une option. `-WithoutAI` désactive les appels IA (l'ancien alias `-WithoutGemini` reste accepté). `-AIADData` accepte ces options ; il reste incompatible avec `-ReferenceCases`, `-SmokeTest` et `-VerifyAIAD`.

- `-WithoutAI` utilise les calculs et les règles OptiSpace.
- `-ReferenceCases` charge le jeu simulé IOT-38 dans une base distincte.
- `-SmokeTest` vérifie le cas J-01 sur la route du tableau de bord, puis arrête les serveurs.
- `-VerifyAIAD` rejoue la recette dans une base temporaire à l'instant fixé au 20 novembre 2026 à 12 h UTC, puis s'arrête. Il appelle Groq pour le rapport et la synthèse courte ; ajouter `-WithoutAI` pour l'éviter. Les artefacts sont écrits dans `output/aiad/`.
- `-AIADData` ouvre la base `output/aiad/demo.sqlite3` issue de cette recette et préserve la base de démonstration habituelle. Régler les dates du rapport sur **23/10/2026–19/11/2026 inclus**, de 9 h à 18 h, lundi–vendredi, pour retrouver les chiffres documentés.

Les KPI sont calculés par OptiSpace. Dans le rapport, Groq rédige désormais une synthèse, les justifications des priorités et des étapes proposées lorsque la clé, les données et le fournisseur le permettent (IOT-88). La synthèse courte du tableau de bord conserve son ancien fonctionnement de sélection de constats.

### Lecture du rapport (IOT-87)

Le tableau de bord ouvre **Analyse des espaces**. **Suivi des salles** conserve le suivi opérationnel et la synthèse courte ; revenir à l’analyse conserve le rapport déjà généré. Les raccourcis **7 / 28 / 90 jours** règlent les dates terminées, et **Adapter les horaires** permet de changer les heures et les jours ouvrés. Ces commandes ne sollicitent pas l’IA.

Après **Générer le rapport**, les filtres se replient et le résultat reçoit le focus. Les quatre KPI agrandis restent visibles au-dessus des onglets, avec leurs dénominateurs. **Recommandations** s’ouvre en premier : chaque ligne indique la salle, la priorité, un chiffre clé et la première étape proposée. **Détails** révèle le constat, la justification, les étapes complètes et le suivi. **Le regard de l’IA** donne accès à la synthèse complète et au point de vigilance. Les durées sont en heures/minutes et les pourcentages au format français, à partir des faits serveur.

Les onglets **Indicateurs** (une courbe sélectionnable, définitions et comparaison temporelle) et **Salles** permettent d’approfondir. La couverture et les salles à vérifier restent visibles au-dessus des onglets. Le statut distingue une analyse effectivement obtenue des règles de secours. **Vérifier la génération Groq** indique le modèle, la réception, la durée, les jetons et l’identifiant de réponse lorsqu’ils sont fournis. La méthode et les limites restent accessibles à la demande.

**Modifier le périmètre** rouvre les filtres. Le rapport et son PDF restent disponibles pendant une modification ou après un échec de génération ; un avertissement explicite indique que les nouveaux filtres ne sont pas encore appliqués. Une période invalide désactive la génération. Les actions restent des propositions à examiner par le Facility Manager. Ouvrir un détail, changer d’onglet ou télécharger le PDF n’appelle pas l’IA.

La recette `verify_browser.py` couvre ce parcours, le repli, la couverture partielle, l’absence de mesures, la validation des dates, le PDF et le mobile. Pour préserver les preuves précédentes, utiliser `--output <nouveau-dossier>` contenant une copie du `demo.sqlite3` préparé. Les deux serveurs de recette utilisent les ports 5310/5311 et ne remplacent pas la démo 5300/5301.

### Analyse rédigée par IA (IOT-88)

Les appels IA utilisent exclusivement Groq. Les libellés indiquent **Analyse rédigée par l’IA · Groq**, **Étapes proposées par l’IA · Groq** et **Vérifier la génération Groq**.

Cette évolution dépasse le contrat initial qui limitait Gemini à un classement d’identifiants. Après un appel accepté, **Ce qu’il faut retenir**, le point de vigilance, **Pourquoi cette priorité**, **Étapes proposées par Groq** et **À vérifier ensuite** viennent du modèle. Les constats chiffrés et les indicateurs de suivi viennent toujours d’OptiSpace. L’écran et le PDF reprennent la même réponse, sans second appel pour le téléchargement.

L'intégration d'IOT-86 conserve ses protections : seuls les agrégats numériques, identifiants de salle/action, types d'action, période et horaires sont envoyés au fournisseur. Noms, équipements et preuves en texte libre restent côté serveur. La consigne `fm-analysis-3` relie chaque action à ses KPI par `room_id`. Les avertissements de mesure restent affichés même si l'IA ne les sélectionne pas ; `facts_revision` identifie les faits indépendamment du texte et de l'heure de génération. Le classement de secours `fm-report-pilot-2` examine les écarts de réservation par durée observée, après les problèmes de couverture.

Les huit scénarios pilotes d'IOT-86 restent rejouables :

```powershell
backend/.venv/Scripts/python.exe scripts/local-demo/evaluate_priorities.py --output output/priorities
```

Ajouter `--real-provider --repeats 1` uniquement pour demander des appels Groq réels. Les réponses et échecs sont enregistrés séparément ; les critères pilotes et la stabilité du classement ne valident pas l'utilité métier ni la justesse sémantique des textes. La clé est lue par `Settings`, comme pour la commande de recette Python.

Le modèle reçoit le périmètre, des agrégats associés à des identifiants techniques et des actions admissibles. Il retourne un JSON borné : synthèse, références, au plus trois priorités avec justification, une ou deux étapes et un contrôle proposé. Le serveur rejette les références inconnues, les doublons, les champs supplémentaires, les textes trop longs, les chiffres numériques dans la prose, le balisage et les liens. Ces contrôles de format ne prouvent pas la justesse sémantique de l’analyse : le Facility Manager doit relire les propositions, notamment les hypothèses et les causes possibles.

L’appel du rapport utilise `max_completion_tokens=2400` et un délai HTTPX de 30 secondes par phase réseau, sans nouvelle tentative automatique. La synthèse courte du tableau de bord garde 512 jetons et 12 secondes. La clé reste côté serveur, via `Settings`. Le modèle est configurable avec `GROQ_MODEL` (défaut `openai/gpt-oss-120b`).

Si Groq échoue, les textes IA sont absents et l’écran affiche **Analyse Groq non obtenue** avec les pistes des règles. Un rapport HTTP 200 signifie que les mesures/PDF sont disponibles, pas que l’analyse IA a réussi. Pour vérifier l’IA, contrôler `analysis` non nul, `summary.provider_status=ready`, `summary.generation`, et relire le contenu. Un test avec double ne prouve pas un appel réel. Le gain métier reste à évaluer avec un Facility Manager.

## Configuration Groq

Ouvrir `scripts/local-demo/Configurer-Groq.cmd`, coller la clé dans la saisie masquée puis valider avec Entrée. Attendre **Clé Groq enregistrée. Le serveur peut maintenant la charger.** Le script appelle `Set-OptiSpaceGroq.ps1` et conserve la clé dans `.groq-key.xml`, chiffrée pour le compte Windows courant et exclue de Git. Aucun accès au compte ni partage de clé dans le chat n’est nécessaire.

Après avoir arrêté la démonstration précédente, lancer :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Start-OptiSpace.ps1 -ReportProvider groq
```

Ajouter `-AIADData` pour réutiliser le jeu figé. Le serveur lit `GROQ_API_KEY` et `GROQ_MODEL` via `Settings`, pour les deux fonctions IA. Le modèle par défaut est `openai/gpt-oss-120b`, hébergé par Groq. Les anciens réglages `GEMINI_API_KEY`, `GEMINI_MODEL` et `REPORT_AI_PROVIDER` sont ignorés, y compris dans un ancien `.env` ; ils ne bloquent pas le démarrage et ne configurent aucun appel. Une ancienne clé Gemini ne remplace jamais une clé Groq manquante. L'adaptateur `gemini.py` et son script de configuration ont été retirés ; les anciennes clés locales ne sont pas effacées.

Groq reçoit des agrégats minimisés, validés avec les mêmes contrôles métier. Le résultat expose `summary.provider=groq`, le modèle et la trace de la réponse acceptée. Les KPI et la mise en page du PDF sont calculés par OptiSpace ; la synthèse, les justifications et les étapes viennent de l’IA lorsque l’appel réussit. Groq utilise `max_completion_tokens=2400` et le même délai réseau de 30 secondes par phase.

**Générer la synthèse** et **Générer le rapport** passent tous deux par `services/groq.py`. La synthèse courte garde son contrat borné : sélection de constats et d’une recommandation admissibles, textes chiffrés construits par OptiSpace, couverture obligatoire si des mesures manquent. Les clés sont retirées de l’environnement avant le lancement du frontend.

## Mesurer les KPI et le PDF

Le calcul reprend la projection de quatre colonnes de Hugo (`bfba9d5`, PR #38) et la lecture par lots de 2 048 lignes de la PR #39. Les observations ne sont plus matérialisées en objets ORM. Les minutes de présence, absence et état inconnu sont regroupées en trois ensembles ; les créneaux sont classés par heure et les intersections du périmètre réutilisées pour chaque jour. Présence prioritaire, absence uniquement observée, dénominateurs, réservations effectives, horloge synchronisée et changements d'heure conservent leur sémantique.

Depuis la racine du dépôt, créer une **nouvelle** base réservée au benchmark :

```powershell
& ./backend/.venv/Scripts/python.exe ./scripts/local-demo/benchmark_report.py --database output/bench/fm.sqlite3 --seed --days 28 --rooms 10 --output output/bench/seed.json
& ./backend/.venv/Scripts/python.exe ./scripts/local-demo/benchmark_report.py --database output/bench/fm.sqlite3 --days 28 --rooms 10 --output output/bench/before.json
# Après le changement à comparer, dans un nouveau processus :
& ./backend/.venv/Scripts/python.exe ./scripts/local-demo/benchmark_report.py --database output/bench/fm.sqlite3 --days 28 --rooms 10 --compare output/bench/before.json --output output/bench/after.json
```

`--seed` refuse une base existante et génère des heartbeats toutes les 10 secondes de 7 h à 1 h, avec une réservation quotidienne par salle. Aucun accès au service IA : la clé est neutralisée dans le processus. Sans `--seed`, le script lit les données ; il ne les renouvelle pas. Il affiche les secondes de calcul, de rendu PDF et le pic mémoire du processus, écrit le rapport complet et son PDF, puis vérifie leur instantané JSON si `--compare` est fourni. Les PDF peuvent différer au niveau binaire à cause de leurs métadonnées ReportLab. `--kind dashboard` mesure la première salle ; `--profile` produit un fichier cProfile, dont les durées ne doivent pas être comparées à des exécutions sans profilage.

Les mesures sont locales et séquentielles sur SQLite, hors attente Groq et transport HTTP. Elles ne valident ni PostgreSQL, ni la mémoire du pod, ni des appels concurrents. Le scénario initial n'alimente pas la période précédente ; un benchmark comparatif doit l'alimenter séparément. La limite métier de 93 jours, les seuils pilotes, la disposition du dashboard et la configuration IA de staging restent à arbitrer avec le PO. Aucun changement de limite mémoire ou de déploiement n'est effectué par ce script.

## Recette AIAD à date fixe

```powershell
& ./backend/.venv/Scripts/python.exe ./scripts/local-demo/verify_aiad.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Start-OptiSpace.ps1 -AIADData -WithoutAI
```

Le premier script rejoue J-01, J-02 et J-04, puis compare les règles, un double de Groq et six replis sur le même jeu multi-salles. Il vérifie également les deux refus d'accès et l'absence de changement des réservations. Les fixtures et les salles FM restent dans des organisations de recette séparées. Les données sont simulées, y compris lorsqu'un appel fournisseur réel est demandé.

Pour inclure Groq réel avec la clé déjà configurée :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Start-OptiSpace.ps1 -VerifyAIAD
```

Le lanceur charge la clé sans en afficher la valeur. Une clé DPAPI doit être déchiffrée par le compte Windows qui l'a enregistrée. La commande Python directe accepte `--real-provider` si `Settings` trouve déjà la clé Groq dans l'environnement ou les fichiers de configuration ; elle ne lit pas le fichier DPAPI. Le double de test utilise le contrat Groq. La recette réelle vérifie le rapport et la synthèse courte, avec les résultats séparés `real_provider` et `real_summary_provider`. Un statut `ready` confirme une génération acceptée ; un HTTP 200 peut également contenir un repli. L'ancien argument `--real-gemini` est retiré. Utiliser `--output <nouveau-dossier>` avec la commande Python pour conserver les preuves précédentes.

Le seeder IOT-38 contrôle les durées observées, occupées, inconnues et libérées, les taux d'occupation/couverture et le mode de synthèse pour **J-01, J-02 et J-04 uniquement**. `-SmokeTest` vérifie seulement J-01 via HTTP : occupation 50 %, 180 min observées, mode règles. Il ne constitue pas un rejeu de tous les cas présents dans le JSON.
