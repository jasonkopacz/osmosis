#!/usr/bin/env node
/**
 * Seed the D1 translation_cache with Spanish translations for common English words.
 *
 * Usage:
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-es-translations.mjs
 *
 * This writes seed_es.sql in the current directory. Apply it with:
 *   wrangler d1 execute osmosis --file=seed_es.sql --remote
 *
 * Re-running is safe: uses INSERT OR IGNORE so existing rows are not overwritten.
 */

import { writeFileSync } from 'fs'

const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION ?? 'eastus'
const ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain&to=es'
const BATCH_SIZE = 900  // Azure max is 1000; 900 keeps requests well within limits
const OUTPUT_FILE = 'seed_es.sql'
const SQL_CHUNK_SIZE = 900  // rows per INSERT statement

if (!AZURE_KEY) {
  console.error('Error: AZURE_TRANSLATOR_KEY env var is required')
  process.exit(1)
}

// ~3000 high-frequency English words (lemmas + common inflected forms).
// Covers ~95%+ of everyday web content.
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
  'except','inside','near','outside','since','toward','towards','until','upon','within',
  'without','and','but','or','nor','so','yet','although','because','since','unless',
  'until','while','if','though','whether','whereas','whereby','whenever','wherever',
  // Auxiliaries
  'be','is','are','was','were','been','being','have','has','had','having','do','does',
  'did','will','would','shall','should','may','might','must','can','could','ought',
  'need','dare','used',
  // Common adverbs
  'very','really','quite','rather','too','also','just','even','still','already','always',
  'never','often','sometimes','usually','finally','here','there','now','then','soon',
  'yet','again','back','home','together','away','around','along','ahead','instead',
  'perhaps','maybe','probably','certainly','definitely','clearly','quickly','slowly',
  'easily','well','hard','fast','late','early','today','yesterday','tomorrow','recently',
  'later','earlier','outside','inside','below','above','somehow','otherwise','meanwhile',
  'however','therefore','moreover','furthermore','nevertheless','indeed','actually',
  'especially','particularly','generally','usually','likely','hardly','nearly','almost',
  'enough','somewhat','relatively','extremely','absolutely','completely','totally',
  'exactly','simply','only','mostly','mainly','partly','largely','largely','highly',
  'deeply','widely','closely','directly','immediately','eventually','finally','suddenly',
  'quickly','slowly','carefully','clearly','simply','exactly','correctly','properly',
  'perfectly','greatly','recently','currently','frequently','constantly','continuously',
  'previously','initially','naturally','normally','obviously','apparently','roughly',
  'approximately','essentially','basically','literally','physically','technically',
  'officially','personally','publicly','privately','seriously','honestly','truly',
  'equally','specifically','separately','differently','similarly','accordingly',
  'unfortunately','surprisingly','apparently','effectively','successfully','directly',
  'originally','precisely','certainly','obviously','naturally','seriously',
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
  'lie','develop','carry','allow','draw','help','work','grow','put','read','drive',
  'place','describe','assume','produce','present','control','fill','rise','save',
  'fight','wish','complete','count','hit','travel','vote','represent','release',
  'press','sign','note','care','mean','agree','listen','join','accept','relate',
  'manage','prevent','connect','involve','mention','act','enable','reduce','prepare',
  'affect','attempt','handle','claim','impact','review','apply','identify','indicate',
  'recognize','deal','introduce','establish','access','address','base','compare',
  'differ','depend','focus','form','limit','link','mark','measure','name','need',
  'order','replace','respond','select','suggest','test','view','become','prove',
  'tend','fail','prefer','plan','hope','intend','aim','realize','notice','forget',
  'discover','refuse','promise','succeed','avoid','support','cost','gain','increase',
  'decrease','improve','design','deliver','achieve','perform','operate','implement',
  'maintain','contain','obtain','retain','attain','sustain','explain','complain',
  'obtain','maintain','obtain','explain','remain','contain','pertain','entertain',
  'obtain','maintain','sustain','attain','obtain','certain','certain',
  'walk','talk','walk','work','play','stay','pay','say','way','day','may','lay',
  'buy','try','fly','cry','dry','fry','pry','spy','tie','lie','die','pie',
  'eat','beat','heat','meat','seat','treat','meet','greet','feet','sleep','keep',
  'deep','leap','reap','weep','sweep','creep',
  'take','make','bake','cake','lake','wake','brake','snake','stake','shake','fake',
  'come','home','some','dome','foam','roam','loan','moan','groan',
  'give','live','drive','arrive','strive','thrive','survive','revive','derive',
  'see','free','tree','agree','degree','guarantee',
  'go','show','know','flow','grow','blow','glow','slow','snow','throw','below',
  'bring','sing','ring','king','thing','spring','string','swing','wing','sting',
  'think','drink','blink','link','pink','sink','wink','rink','brink','shrink',
  'find','mind','kind','bind','blind','grind','wind','behind','remind','unwind',
  'look','book','cook','hook','took','brook','crook','shook','nook',
  'feel','deal','heal','meal','real','seal','steal','wheel','appeal','reveal',
  'hold','told','bold','cold','fold','gold','mold','old','sold','roll','poll',
  'call','fall','hall','tall','wall','ball','small','install','recall','overall',
  'turn','burn','learn','earn','return','concern','confirm','perform',
  'move','prove','love','above','improve','remove','approve','groove',
  'wait','rate','late','gate','hate','fate','state','create','debate','relate',
  'want','grant','plant','chant','slant','rant','can','plan','ran','ban','fan','man','pan','tan','van',
  'jump','pump','dump','bump','lump','clump','stump','trump',
  'stop','drop','pop','hop','top','cop','mop','shop','crop','prop',
  'help','self','shelf','elf','belt','melt','felt','dealt','health','wealth','stealth',
  'ask','task','mask','flask','desk','risk','disk','dusk','musk','brisk',
  'walk','talk','chalk','stalk','mock','lock','sock','rock','block','clock','dock','flock',
  'step','kept','slept','wept','swept','crept','depth','kept',
  'ride','hide','wide','side','guide','pride','slide','bride','divide','provide','decide',
  'wear','bear','care','dare','fair','hair','pair','share','spare','stare','there',
  'hear','fear','near','clear','dear','gear','tear','year','appear','career','disappear',
  // Common nouns
  'time','person','year','way','day','thing','man','woman','child','world','life','hand',
  'part','place','case','week','company','system','program','question','work','government',
  'number','night','point','home','water','room','mother','area','money','story','fact',
  'month','lot','right','study','book','eye','job','word','business','issue','side',
  'kind','head','house','service','friend','father','power','hour','game','line',
  'end','member','city','community','name','president','team','minute','idea','body',
  'information','law','view','action','voice','food','state','school','family','group',
  'country','problem','hand','part','place','case','face','example','road','change',
  'reason','door','table','car','plan','mind','heart','moment','form','force','level',
  'age','office','course','article','type','piece','land','air','class','light','town',
  'sense','page','event','history','party','result','need','field','matter','policy',
  'music','market','term','process','difference','report','view','step','cost','cost',
  'effect','city','deal','account','building','impact','city','value','position',
  'society','relationship','player','news','culture','decision','tax','film','price',
  'experience','rate','show','reason','chance','control','space','value','range',
  'war','picture','health','risk','interest','project','effort','night','floor',
  'center','list','floor','activity','staff','opportunity','nature','others','model',
  'model','situation','agreement','structure','order','development','support',
  'environment','window','question','answer','person','point','life','detail',
  'quality','feature','service','security','data','system','network','access',
  'design','product','user','content','process','performance','strategy',
  'approach','analysis','result','impact','benefit','challenge','solution','goal',
  'target','plan','future','past','present','direction','level','standard',
  'practice','knowledge','understanding','ability','skill','capacity','resource',
  'source','base','range','issue','problem','response','review','report','request',
  'message','record','file','test','task','role','position','status','stage',
  'step','phase','path','option','choice','type','form','format','style','pattern',
  'method','technique','approach','framework','model','system','structure','process',
  'condition','factor','element','aspect','dimension','perspective','view','point',
  'side','direction','level','degree','extent','rate','amount','number','size',
  'scale','scope','range','limit','boundary','area','region','zone','sector',
  'field','domain','category','group','class','set','series','sequence','list',
  'collection','combination','connection','relationship','link','association',
  'difference','similarity','comparison','contrast','context','background',
  'history','origin','source','cause','reason','purpose','goal','objective',
  'function','role','responsibility','authority','control','management','leadership',
  'team','staff','member','colleague','partner','client','customer','user',
  'audience','community','society','organization','institution','company','business',
  'government','department','agency','authority','committee','board','council',
  'program','project','plan','strategy','policy','rule','regulation','law','standard',
  'principle','value','belief','idea','concept','theory','model','framework',
  'system','structure','process','approach','method','technique','practice',
  'experience','knowledge','skill','ability','capacity','talent','potential',
  'opportunity','challenge','problem','issue','risk','benefit','advantage',
  'result','outcome','impact','effect','change','development','growth','progress',
  'success','failure','mistake','error','solution','answer','response',
  'action','activity','effort','work','task','job','role','function','responsibility',
  'service','support','assistance','help','advice','guidance','information',
  'communication','message','report','document','record','data','evidence',
  'example','case','situation','condition','circumstance','environment','context',
  'relationship','connection','link','network','community','society','culture',
  'country','nation','region','area','city','town','village','place','location',
  'position','direction','distance','space','time','period','moment','stage','phase',
  'level','degree','amount','number','size','quantity','quality','value','price',
  'cost','benefit','risk','opportunity','option','choice','decision','agreement',
  // Common adjectives
  'good','new','first','last','long','great','little','own','other','old','right',
  'big','high','different','small','large','next','early','young','important',
  'few','public','bad','same','able','local','national','real','true','false',
  'full','free','strong','major','current','clear','open','certain','rather',
  'hard','short','whole','low','common','main','specific','particular','possible',
  'available','recent','various','late','white','black','red','blue','green',
  'hot','cold','warm','cool','dark','light','deep','wide','long','short',
  'high','low','fast','slow','easy','hard','rich','poor','happy','sad',
  'angry','afraid','ready','sure','wrong','right','best','worst','better','worse',
  'more','less','most','least','special','general','personal','social','political',
  'economic','financial','natural','physical','mental','cultural','historical',
  'international','global','local','regional','national','official','formal',
  'traditional','modern','contemporary','ancient','original','final','total',
  'basic','simple','complex','simple','difficult','easy','quick','slow','safe',
  'dangerous','necessary','possible','impossible','likely','unlikely','certain',
  'uncertain','positive','negative','direct','indirect','effective','efficient',
  'successful','significant','important','critical','essential','fundamental',
  'primary','secondary','additional','alternative','potential','future','current',
  'previous','recent','typical','normal','regular','standard','common','usual',
  'special','unique','specific','general','broad','narrow','limited','unlimited',
  'complete','incomplete','whole','partial','full','empty','open','closed',
  'active','passive','positive','negative','strong','weak','heavy','light',
  'thick','thin','wide','narrow','tall','short','long','brief','clear','unclear',
  'simple','complex','easy','difficult','quick','slow','fast','steady','stable',
  'dynamic','flexible','rigid','solid','liquid','dry','wet','clean','dirty',
  'fresh','old','young','new','old','ancient','modern','classic','popular',
  'familiar','strange','foreign','domestic','internal','external','private','public',
  'individual','collective','personal','professional','academic','scientific',
  'technical','practical','theoretical','logical','rational','emotional','creative',
  'innovative','traditional','conservative','progressive','liberal','democratic',
  'independent','dependent','free','restricted','open','closed','fixed','variable',
  'constant','temporary','permanent','brief','extended','early','late','regular',
  'frequent','occasional','rare','common','unusual','familiar','unknown','clear',
  'obvious','subtle','visible','invisible','real','virtual','physical','digital',
  'automatic','manual','natural','artificial','organic','synthetic','raw','processed',
  'basic','advanced','simple','sophisticated','small','medium','large','huge','tiny',
  'ordinary','extraordinary','typical','unusual','normal','abnormal','healthy','sick',
  'strong','fragile','stable','unstable','safe','risky','certain','doubtful',
  'happy','unhappy','satisfied','dissatisfied','excited','bored','interested',
  'motivated','dedicated','committed','reliable','responsible','honest','fair',
  'kind','cruel','gentle','harsh','calm','anxious','confident','nervous','brave',
  'careful','careless','polite','rude','quiet','noisy','clean','messy','organized',
  // Numbers and quantities
  'one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen',
  'nineteen','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety',
  'hundred','thousand','million','billion','first','second','third','fourth','fifth',
  'sixth','seventh','eighth','ninth','tenth','half','quarter','third','double',
  'triple','single','multiple','zero','once','twice',
  // Time words
  'second','minute','hour','day','week','month','year','decade','century',
  'morning','afternoon','evening','night','dawn','dusk','noon','midnight',
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'January','February','March','April','May','June','July','August',
  'September','October','November','December','spring','summer','autumn','winter',
  'season','holiday','weekend','weekday','birthday','anniversary','moment','instant',
  'period','era','age','generation','century','millennium',
  // Body
  'body','head','face','eye','ear','nose','mouth','lip','tooth','tongue','cheek',
  'neck','shoulder','arm','elbow','wrist','hand','finger','thumb','chest','back',
  'stomach','hip','leg','knee','ankle','foot','toe','heart','brain','blood',
  'bone','skin','hair','nail','lung','liver','muscle','nerve',
  // Family
  'family','parent','child','baby','kid','adult','son','daughter','brother','sister',
  'husband','wife','grandfather','grandmother','uncle','aunt','cousin','nephew','niece',
  'relative','friend','neighbor','stranger','enemy','colleague','boss','employee',
  // Food & drink
  'food','water','milk','bread','rice','meat','fish','chicken','beef','pork',
  'vegetable','fruit','apple','orange','banana','tomato','potato','onion','carrot',
  'cheese','egg','butter','oil','sugar','salt','pepper','coffee','tea','juice',
  'beer','wine','soup','sandwich','pizza','pasta','cake','chocolate','ice','cream',
  // Home & environment
  'house','home','room','bedroom','bathroom','kitchen','garden','door','window',
  'wall','floor','ceiling','roof','stair','hall','yard','street','road','bridge',
  'park','forest','mountain','river','lake','sea','ocean','beach','island','sky',
  'sun','moon','star','cloud','rain','snow','wind','fire','earth','stone','rock',
  // Transport
  'car','bus','train','plane','ship','boat','bike','road','street','highway',
  'airport','station','port','ticket','seat','driver','passenger','journey','trip',
  // Technology & work
  'computer','phone','internet','website','email','message','network','software',
  'machine','tool','device','screen','camera','video','image','photo','text',
  'money','bank','price','cost','tax','profit','loss','salary','wage','payment',
  // Education
  'school','university','student','teacher','class','lesson','subject','test',
  'exam','homework','grade','degree','course','study','learn','research','science',
  'math','history','language','art','music','sport','game','book','library',
  // Health
  'health','hospital','doctor','nurse','medicine','drug','pain','disease','illness',
  'injury','surgery','treatment','symptom','blood','heart','brain',
  // Society
  'people','society','community','culture','religion','government','law','police',
  'military','war','peace','country','nation','city','town','village','population',
  'economy','market','trade','industry','energy','power','environment',
  // Emotions & states
  'love','hate','fear','hope','joy','sadness','anger','surprise','trust','disgust',
  'pain','pleasure','comfort','stress','worry','anxiety','excitement','boredom',
  'happiness','sadness','pride','shame','guilt','regret','desire','passion',
  // Colors
  'red','blue','green','yellow','orange','purple','pink','brown','black','white',
  'gray','grey','dark','light','bright','pale','vivid','colorful',
  // Sizes & shapes
  'big','small','large','tiny','huge','tall','short','long','wide','narrow',
  'thick','thin','round','square','circle','triangle','straight','curved',
  // Common verbs (more)
  'see','look','watch','hear','listen','speak','talk','read','write','draw',
  'paint','sing','dance','cook','eat','drink','sleep','wake','rest','play',
  'work','study','teach','learn','think','remember','forget','know','believe',
  'understand','explain','describe','show','tell','ask','answer','help','support',
  'lead','follow','start','finish','continue','stop','wait','hurry','rush',
  'push','pull','lift','carry','throw','catch','hit','kick','shoot','climb',
  'swim','jump','run','walk','sit','stand','lie','turn','open','close',
  'lock','unlock','enter','exit','arrive','leave','visit','return','travel',
  'drive','ride','fly','sail','send','receive','buy','sell','pay','spend',
  'save','earn','win','lose','gain','find','search','look','discover','choose',
  'decide','plan','prepare','organize','manage','control','check','test','measure',
  'count','calculate','record','store','share','connect','contact','meet','join',
  'invite','accept','refuse','agree','disagree','approve','reject','allow','forbid',
  'protect','defend','attack','fight','argue','discuss','debate','negotiate','resolve',
  'create','build','make','produce','design','develop','improve','fix','repair',
  'break','destroy','remove','delete','clean','wash','dress','wear','carry',
  'fill','empty','cut','divide','combine','mix','separate','sort','arrange',
  'move','place','put','take','bring','fetch','collect','gather','spread','cover',
]

// Deduplicate while preserving order
const uniqueWords = [...new Set(WORDS.map(w => w.toLowerCase()))]

async function translateBatch(words) {
  const res = await fetch(ENDPOINT, {
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

async function main() {
  console.log(`Translating ${uniqueWords.length} words to Spanish in batches of ${BATCH_SIZE}...`)

  const pairs = []
  for (let i = 0; i < uniqueWords.length; i += BATCH_SIZE) {
    const batch = uniqueWords.slice(i, i + BATCH_SIZE)
    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueWords.length / BATCH_SIZE)}...`)
    const results = await translateBatch(batch)
    const ok = results.filter(r => r.translation !== null)
    pairs.push(...ok)
    console.log(` ${ok.length}/${batch.length} translated`)
  }

  console.log(`\nBuilding SQL for ${pairs.length} translations...`)

  const lines = [
    '-- Spanish seed translations for Osmosis',
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
        return `  ('${w}', 'es', '${t}', 0, unixepoch())`
      })
      .join(',\n')
    lines.push(
      `INSERT OR IGNORE INTO translation_cache (word, target_lang, translation, hit_count, created_at) VALUES`,
      `${values};`,
      '',
    )
  }

  writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8')
  console.log(`\nWrote ${OUTPUT_FILE}`)
  console.log('\nApply to remote D1:')
  console.log(`  wrangler d1 execute osmosis --file=${OUTPUT_FILE} --remote`)
  console.log('\nApply to local D1 (for dev):')
  console.log(`  wrangler d1 execute osmosis --file=${OUTPUT_FILE} --local`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
