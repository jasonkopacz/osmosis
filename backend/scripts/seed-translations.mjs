#!/usr/bin/env node
/**
 * Seed the D1 translation_cache with translations for common English words.
 *
 * Usage:
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs <lang>
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs all
 *
 * Examples:
 *   node scripts/seed-translations.mjs fr
 *   node scripts/seed-translations.mjs it
 *   node scripts/seed-translations.mjs all
 *
 * Writes seed_<lang>.sql in the project root. Apply with:
 *   wrangler d1 execute osmosis --file=seed_fr.sql --remote
 *
 * Re-running is safe: uses INSERT OR IGNORE.
 */

import { writeFileSync } from 'fs'

const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION ?? 'eastus'
const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain'
const BATCH_SIZE = 900
const SQL_CHUNK_SIZE = 900

const LANGUAGES = {
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  de: 'German',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  tr: 'Turkish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-Hans': 'Chinese (Simplified)',
  ar: 'Arabic',
  hi: 'Hindi',
}

// ~1500 high-frequency English words covering ~95%+ of everyday web content.
const WORDS = [
  // Function words
  'the','a','an','this','that','these','those','some','any','each','every','all','both',
  'either','neither','no','much','many','few','little','several','another','other',
  // Pronouns
  'i','me','my','mine','myself','you','your','yours','yourself','he','him','his','himself',
  'she','her','hers','herself','it','its','itself','we','us','our','ours','ourselves',
  'they','them','their','theirs','themselves','who','whom','whose','which','what','whoever',
  'whatever','whichever','someone','something','anyone','anything','everyone','everything',
  'nobody','nothing','somewhere','anywhere','everywhere','nowhere',
  // Prepositions & conjunctions
  'in','on','at','by','for','with','about','against','between','into','through','during',
  'before','after','above','below','to','from','up','down','out','off','over','under',
  'again','further','once','across','along','around','behind','beside','beyond','despite',
  'except','inside','near','outside','since','toward','until','upon','within','without',
  'and','but','or','nor','so','yet','although','because','unless','while','if','though',
  'whether','whereas','whenever','wherever',
  // Auxiliaries
  'be','is','are','was','were','been','being','have','has','had','having','do','does',
  'did','will','would','shall','should','may','might','must','can','could','need',
  // Common adverbs
  'very','really','quite','rather','too','also','just','even','still','already','always',
  'never','often','sometimes','usually','finally','here','there','now','then','soon',
  'yet','again','back','home','together','away','around','ahead','instead','perhaps',
  'maybe','probably','certainly','definitely','clearly','quickly','slowly','easily',
  'well','hard','fast','late','early','today','yesterday','tomorrow','recently','later',
  'however','therefore','moreover','furthermore','nevertheless','indeed','actually',
  'especially','particularly','generally','likely','hardly','nearly','almost','enough',
  'extremely','absolutely','completely','exactly','simply','only','mostly','mainly',
  // Top verbs
  'say','get','make','go','know','take','see','come','think','look','want','give',
  'use','find','tell','ask','seem','feel','try','leave','call','keep','let','begin',
  'show','hear','play','run','move','live','believe','hold','bring','happen','write',
  'provide','sit','stand','lose','pay','meet','include','continue','set','learn',
  'change','lead','understand','watch','follow','create','open','walk','win','offer',
  'remember','love','consider','appear','buy','wait','serve','die','send','expect',
  'build','stay','fall','cut','reach','kill','remain','suggest','raise','pass','sell',
  'require','report','decide','pull','break','speak','eat','cover','enter','stop',
  'add','choose','push','close','spend','turn','start','point','return','explain',
  'develop','carry','allow','draw','help','work','grow','put','read','drive','place',
  'describe','assume','produce','present','control','fill','rise','save','fight','wish',
  'complete','count','hit','travel','vote','represent','release','press','sign','care',
  'mean','agree','listen','join','accept','relate','manage','prevent','connect','involve',
  'mention','act','enable','reduce','prepare','affect','attempt','handle','claim',
  'impact','review','apply','identify','indicate','recognize','deal','introduce',
  'establish','access','address','compare','depend','focus','form','limit','link',
  'measure','name','order','replace','respond','select','test','view','become','prove',
  'tend','fail','prefer','plan','hope','realize','notice','forget','discover','refuse',
  'promise','succeed','avoid','support','cost','gain','increase','decrease','improve',
  'deliver','achieve','perform','operate','implement','maintain','contain','obtain',
  // Common nouns
  'time','person','year','way','day','thing','man','woman','child','world','life',
  'hand','part','place','case','week','company','system','program','question','work',
  'government','number','night','point','home','water','room','mother','area','money',
  'story','fact','month','right','study','book','eye','job','word','business','issue',
  'side','kind','head','house','service','friend','father','power','hour','game','line',
  'end','member','city','community','name','team','minute','idea','body','information',
  'law','view','action','voice','food','state','school','family','group','country',
  'problem','face','example','road','change','reason','door','table','car','plan',
  'mind','heart','moment','form','force','level','age','office','course','type','piece',
  'land','air','class','light','town','sense','page','event','history','party','result',
  'need','field','matter','policy','music','market','term','process','difference',
  'report','step','cost','effect','deal','building','value','position','society',
  'relationship','news','culture','decision','tax','price','experience','rate','show',
  'reason','chance','control','space','range','war','picture','health','risk','interest',
  'project','effort','center','list','activity','opportunity','nature','model','situation',
  'agreement','structure','order','development','support','environment','window',
  'question','answer','detail','quality','feature','security','data','network','design',
  'product','user','content','performance','strategy','approach','analysis','benefit',
  'challenge','solution','goal','target','future','past','present','direction','standard',
  'practice','knowledge','understanding','ability','skill','resource','source','base',
  'message','record','file','task','role','status','stage','phase','path','option',
  'choice','format','style','pattern','method','technique','framework','condition',
  'factor','element','aspect','perspective','degree','extent','amount','size','scale',
  'scope','boundary','region','zone','sector','domain','category','series','sequence',
  'collection','combination','connection','context','background','origin','cause',
  'purpose','objective','function','responsibility','authority','leadership','partner',
  'client','customer','audience','institution','department','agency','committee',
  'regulation','principle','belief','concept','theory',
  // Common adjectives
  'good','new','first','last','long','great','little','own','other','old','right',
  'big','high','different','small','large','next','early','young','important','few',
  'public','bad','same','able','local','national','real','true','false','full','free',
  'strong','major','current','clear','open','certain','hard','short','whole','low',
  'common','main','specific','particular','possible','available','recent','various',
  'late','white','black','red','blue','green','hot','cold','warm','cool','dark','light',
  'deep','wide','fast','slow','easy','rich','poor','happy','sad','angry','afraid',
  'ready','sure','wrong','best','worst','better','worse','more','less','most','least',
  'special','general','personal','social','political','economic','financial','natural',
  'physical','mental','cultural','historical','international','global','regional',
  'official','formal','traditional','modern','ancient','original','final','total',
  'basic','simple','complex','difficult','quick','safe','dangerous','necessary',
  'likely','unlikely','positive','negative','direct','effective','efficient',
  'successful','significant','critical','essential','fundamental','primary','secondary',
  'additional','alternative','potential','typical','normal','regular','standard',
  'unique','broad','narrow','limited','complete','whole','partial','empty','active',
  'passive','heavy','thick','thin','tall','brief','solid','dry','wet','clean','fresh',
  'foreign','domestic','internal','external','private','individual','collective',
  'professional','academic','scientific','technical','practical','theoretical',
  'logical','rational','emotional','creative','innovative','conservative','progressive',
  'independent','dependent','restricted','fixed','variable','constant','temporary',
  'permanent','extended','frequent','occasional','rare','unusual','familiar','obvious',
  'subtle','visible','digital','automatic','manual','organic','raw','processed',
  'advanced','sophisticated','medium','huge','tiny','ordinary','extraordinary',
  'healthy','sick','fragile','stable','unstable','risky','doubtful','satisfied',
  'excited','bored','interested','motivated','dedicated','reliable','responsible',
  'honest','fair','kind','cruel','gentle','harsh','calm','anxious','confident','nervous',
  'brave','careful','careless','polite','rude','quiet','noisy','organized',
  // Numbers and quantities
  'one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
  'thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty',
  'thirty','forty','fifty','sixty','seventy','eighty','ninety','hundred','thousand',
  'million','billion','first','second','third','fourth','fifth','half','quarter','double',
  'triple','single','multiple','zero','once','twice',
  // Time
  'second','minute','hour','day','week','month','year','decade','century','morning',
  'afternoon','evening','night','dawn','dusk','noon','midnight','monday','tuesday',
  'wednesday','thursday','friday','saturday','sunday','january','february','march',
  'april','may','june','july','august','september','october','november','december',
  'spring','summer','autumn','winter','season','holiday','weekend','weekday','birthday',
  'anniversary','moment','period','era','generation','millennium',
  // Body
  'body','head','face','eye','ear','nose','mouth','lip','tooth','tongue','neck',
  'shoulder','arm','elbow','wrist','hand','finger','thumb','chest','back','stomach',
  'hip','leg','knee','ankle','foot','toe','heart','brain','blood','bone','skin',
  'hair','lung','liver','muscle','nerve',
  // Family & people
  'family','parent','child','baby','adult','son','daughter','brother','sister',
  'husband','wife','grandfather','grandmother','uncle','aunt','cousin','nephew','niece',
  'relative','friend','neighbor','stranger','enemy','colleague','boss','employee',
  // Food & drink
  'food','water','milk','bread','rice','meat','fish','chicken','beef','pork',
  'vegetable','fruit','apple','orange','banana','tomato','potato','onion','carrot',
  'cheese','egg','butter','oil','sugar','salt','pepper','coffee','tea','juice',
  'beer','wine','soup','sandwich','pizza','pasta','cake','chocolate',
  // Home & environment
  'house','home','room','bedroom','bathroom','kitchen','garden','door','window',
  'wall','floor','ceiling','roof','yard','street','road','bridge','park','forest',
  'mountain','river','lake','sea','ocean','beach','island','sky','sun','moon','star',
  'cloud','rain','snow','wind','fire','earth','stone','rock',
  // Transport
  'car','bus','train','plane','ship','boat','bike','highway','airport','station',
  'port','ticket','seat','driver','passenger','journey','trip',
  // Technology & finance
  'computer','phone','internet','website','email','network','software','machine',
  'tool','device','screen','camera','video','image','photo','text','money','bank',
  'price','cost','tax','profit','loss','salary','wage','payment',
  // Education
  'school','university','student','teacher','class','lesson','subject','exam',
  'homework','grade','degree','course','research','science','math','language',
  'art','sport','library',
  // Health
  'hospital','doctor','nurse','medicine','drug','pain','disease','illness','injury',
  'surgery','treatment','symptom',
  // Society
  'people','religion','police','military','war','peace','nation','population',
  'economy','trade','industry','energy','environment',
  // Emotions
  'love','hate','fear','hope','joy','sadness','anger','surprise','trust',
  'pleasure','comfort','stress','worry','anxiety','excitement','boredom','happiness',
  'pride','shame','guilt','regret','desire','passion',
  // Colors & shapes
  'gray','purple','pink','brown','yellow','bright','pale','round','square','circle',
  'triangle','straight','curved',
]

const uniqueWords = [...new Set(WORDS.map(w => w.toLowerCase()))]

async function translateBatch(words, langCode) {
  const url = `${AZURE_ENDPOINT}&to=${encodeURIComponent(langCode)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_KEY,
      'Ocp-Apim-Subscription-Region': AZURE_REGION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(words.map(w => ({ Text: w }))),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Azure error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return words.map((word, i) => ({ word, translation: data[i]?.translations?.[0]?.text ?? null }))
}

async function seedLanguage(langCode, langName) {
  const outputFile = `seed_${langCode.replace('-', '_')}.sql`
  console.log(`\n[${langCode}] ${langName} — translating ${uniqueWords.length} words...`)

  const pairs = []
  for (let i = 0; i < uniqueWords.length; i += BATCH_SIZE) {
    const batch = uniqueWords.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(uniqueWords.length / BATCH_SIZE)
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}...`)
    const results = await translateBatch(batch, langCode)
    const ok = results.filter(r => r.translation !== null)
    pairs.push(...ok)
    console.log(` ${ok.length}/${batch.length} ok`)
  }

  const lines = [
    `-- ${langName} (${langCode}) seed translations for Osmosis`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Words: ${pairs.length}`,
    '',
  ]

  for (let i = 0; i < pairs.length; i += SQL_CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + SQL_CHUNK_SIZE)
    const values = chunk
      .map(({ word, translation }) => {
        const w = word.replace(/'/g, "''")
        const t = translation.replace(/'/g, "''")
        return `  ('${w}', '${langCode}', '${t}', 0, unixepoch())`
      })
      .join(',\n')
    lines.push(
      'INSERT OR IGNORE INTO translation_cache (word, target_lang, translation, hit_count, created_at) VALUES',
      `${values};`,
      '',
    )
  }

  writeFileSync(outputFile, lines.join('\n'), 'utf8')
  console.log(`  Wrote ${outputFile} (${pairs.length} translations)`)
  console.log(`  Apply: wrangler d1 execute osmosis --file=${outputFile} --remote`)
  return outputFile
}

async function main() {
  if (!AZURE_KEY) {
    console.error('Error: AZURE_TRANSLATOR_KEY env var is required')
    process.exit(1)
  }

  const arg = process.argv[2]
  if (!arg) {
    console.error(`Usage: node scripts/seed-translations.mjs <lang|all>`)
    console.error(`\nAvailable languages:`)
    for (const [code, name] of Object.entries(LANGUAGES)) {
      console.error(`  ${code.padEnd(10)} ${name}`)
    }
    process.exit(1)
  }

  const toSeed = arg === 'all'
    ? Object.entries(LANGUAGES)
    : [[arg, LANGUAGES[arg]]]

  if (!LANGUAGES[arg] && arg !== 'all') {
    console.error(`Unknown language: ${arg}`)
    console.error(`Available: ${Object.keys(LANGUAGES).join(', ')}`)
    process.exit(1)
  }

  const written = []
  for (const [code, name] of toSeed) {
    const file = await seedLanguage(code, name)
    written.push({ code, file })
  }

  if (written.length > 1) {
    console.log('\n\nAll done. Apply all files:')
    for (const { file } of written) {
      console.log(`  wrangler d1 execute osmosis --file=${file} --remote`)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
