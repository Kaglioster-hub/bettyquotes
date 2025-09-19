# BettyQuotes — Supreme Ultra Profit™

Comparatore legale di quote (value bets & surebets) con PWA, multilingua, tracking affiliati e deploy zero-costo su Vercel.

## Deploy rapido
```sh
git init && git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/Kaglioster-hub/betty.git
git push -u origin main

# Vercel
vercel --prod --confirm --name bettyquotes --scope kaglioster-hub
vercel domains add bq.vrabo.it
vercel domains add bettyquotes.vrabo.it
```

Configura le variabili su Vercel secondo `.env.example`.
