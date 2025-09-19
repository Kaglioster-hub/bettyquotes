param(
  [string]$GithubUser, [string]$RepoName, [string]$ProjectName, [string]$PrimaryDomain, [string]$AliasDomain,
  [string]$OddsApiKey, [string]$ForceToken, [string]$HashSalt, [string]$Region="eu", [string]$Sports="soccer_epl,basketball_nba,tennis_atp",
  [string]$Bet365Id="YOUR_ID", [string]$SnaiId="YOUR_ID", [string]$WilliamHillId="YOUR_ID", [string]$PlanetwinId="YOUR_ID",
  [string]$AmazonTag="YOURTAG-21", [string]$BetburgerRef="YOUR", [string]$NordvpnOffer="YOUR"
)
function Box($m){Write-Host ("="*60) -f DarkGray; Write-Host $m -f Cyan; Write-Host ("="*60) -f DarkGray}
if(-not(Test-Path .\public\index.html)){Write-Error "Non sei nella cartella bq/";exit 1}

# referrals.json
Box "Aggiorno referrals.json"
$refPath=".\\public\\referrals.json"
if(Test-Path $refPath){
  $ref=Get-Content $refPath -Raw|ConvertFrom-Json
  $ref.bet365="https://affiliate.bet365.com/redirect.aspx?pid=$Bet365Id"
  $ref.williamhill="https://ads.williamhill.com/redirect.aspx?pid=$WilliamHillId"
  $ref.snai="https://affiliati.snai.it/?ref=$SnaiId"
  $ref.planetwin="https://affiliate.planetwin365.it/?ref=$PlanetwinId"
  $ref|ConvertTo-Json -Depth 5|Set-Content $refPath -Encoding UTF8
}else{Write-Warning "referrals.json non trovato"}

# monetize.json
Box "Aggiorno monetize.json (SmartYield)"
$monPath=".\\public\\monetize.json"
if(Test-Path $monPath){
  $mon=Get-Content $monPath -Raw|ConvertFrom-Json
  foreach($c in $mon.campaigns){
    switch($c.slug){
      "bet365" { $c.url="https://affiliate.bet365.com/redirect.aspx?pid=$Bet365Id" }
      "snai"   { $c.url="https://affiliati.snai.it/?ref=$SnaiId" }
      "betburger" { $c.url="https://betburger.com/?ref=$BetburgerRef" }
      "nordvpn"   { $c.url="https://go.nordvpn.net/aff_c?offer_id=$NordvpnOffer" }
      "amazon-sport" { $c.url="https://www.amazon.it/s?k=maglia+calcio&tag=$AmazonTag" }
    }
  }
  $mon|ConvertTo-Json -Depth 8|Set-Content $monPath -Encoding UTF8
}else{Write-Warning "monetize.json non trovato"}

# .env.local
Box "Creo .env.local"
@"
ODDS_API_KEY=$OddsApiKey
BQ_REGION=$Region
BQ_SPORTS=$Sports
BQ_FORCE_TOKEN=$ForceToken
BQ_HASH_SALT=$HashSalt
BQ_VALUE_THRESHOLD=0.07
BQ_SUREBET_MARGIN=0.02
BQ_TTL_SECONDS=300
BQ_TTL_MIN=120
BQ_TTL_MAX=600
BQ_TTL_SOON_MINUTES=90
"@ | Set-Content ".\.env.local" -Encoding UTF8

# Git + push
Box "Git init + push su GitHub $GithubUser/$RepoName"
if(-not(Test-Path .git)){git init|Out-Null}
git add .
git commit -m "chore: BettyQuotes Super Deluxe Free Max — init/updates" --allow-empty
git branch -M main
git remote remove origin 2>$null
git remote add origin https://github.com/$GithubUser/$RepoName.git
git push -u origin main

# Deploy Vercel
Box "Deploy su Vercel (assicurati 'vercel login')"
vercel --prod --confirm --name $ProjectName | Out-Host

# Domini
Box "Collego domini"
vercel domains add $PrimaryDomain | Out-Host
vercel domains add $AliasDomain | Out-Host

Box "FATTO ✓`nRepo: https://github.com/$GithubUser/$RepoName`nPrimary: https://$PrimaryDomain`nAlias:   https://$AliasDomain"
