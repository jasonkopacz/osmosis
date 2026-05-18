#!/usr/bin/env node
/**
 * Seed the D1 translation_cache with translations for common English words.
 *
 * Usage:
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs <lang>
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs all
 *
 * Examples:
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs fr   # one language
 *   AZURE_TRANSLATOR_KEY=<key> node scripts/seed-translations.mjs all  # all 17 at once
 *
 * The script translates, writes SQL, and applies to D1 in one shot.
 * Re-running is safe: uses INSERT OR IGNORE.
 */

import { writeFileSync } from 'fs'
import { execSync } from 'child_process'

const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION ?? 'eastus'
const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=plain'
const BATCH_SIZE = 900
const SQL_CHUNK_SIZE = 900
const INTER_BATCH_DELAY_MS = 3000
const INTER_LANGUAGE_DELAY_MS = 65000
const MAX_RETRIES = 6

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

// ~3000 high-frequency English words + inflections covering ~98%+ of everyday web content.
// Sections: function words, pronouns, prepositions, auxiliaries, adverbs, verbs (base),
// nouns, adjectives, numbers, time, body, family, food, home/environment, transport,
// technology, education, health, society, emotions, colors/shapes,
// present participles (-ing), irregular past tenses, regular past/-ed forms,
// third-person -s forms, irregular/high-freq noun plurals, comparatives,
// web/UI vocabulary.
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

  // Present participles (-ing) — frequently appear in continuous tenses and as modifiers
  'going','getting','making','taking','seeing','coming','knowing','thinking','looking',
  'wanting','giving','using','finding','telling','asking','feeling','trying','leaving',
  'calling','keeping','beginning','showing','hearing','playing','running','moving',
  'living','believing','holding','bringing','writing','sitting','standing','losing',
  'paying','meeting','including','continuing','learning','changing','leading','watching',
  'following','creating','opening','walking','winning','offering','remembering','loving',
  'considering','appearing','buying','waiting','serving','dying','sending','expecting',
  'building','staying','falling','cutting','reaching','killing','remaining','suggesting',
  'raising','passing','selling','requiring','reporting','deciding','pulling','breaking',
  'speaking','eating','covering','entering','stopping','adding','choosing','pushing',
  'closing','spending','turning','starting','returning','explaining','developing',
  'carrying','allowing','drawing','helping','working','growing','reading','driving',
  'placing','producing','filling','fighting','wishing','counting','listening','joining',
  'accepting','managing','reducing','preparing','handling','claiming','applying',
  'identifying','dealing','introducing','comparing','measuring','selecting','testing',
  'becoming','proving','failing','planning','hoping','realizing','noticing','discovering',
  'refusing','promising','avoiding','supporting','gaining','increasing','decreasing',
  'improving','delivering','achieving','performing','maintaining','obtaining','meaning',
  'agreeing','acting','connecting','involving','relating','operating','implementing',
  'enabling','affecting','attempting','focusing','limiting','forming','replacing',
  'responding','indicating','recognizing','depending','saying',

  // Irregular past tenses — among the most common word forms in written English
  'went','came','got','made','took','saw','knew','thought','found','gave','told',
  'felt','left','began','showed','heard','ran','held','brought','wrote','sat','stood',
  'lost','paid','met','led','watched','followed','created','opened','walked','won',
  'offered','remembered','loved','considered','appeared','bought','waited','served',
  'sent','built','stayed','fell','cut','reached','suggested','raised','passed','sold',
  'required','reported','decided','pulled','broke','spoke','ate','covered','entered',
  'stopped','added','chose','pushed','closed','spent','turned','started','returned',
  'explained','developed','drew','grew','drove','produced','filled','rose','saved',
  'fought','listened','joined','accepted','managed','reduced','prepared','handled',
  'applied','dealt','introduced','compared','measured','selected','tested','proved',
  'failed','planned','hoped','realized','noticed','forgot','discovered','refused',
  'promised','avoided','gained','increased','decreased','improved','delivered',
  'achieved','performed','maintained','obtained','meant','agreed','enabled','affected',
  'said','read','put','set','let','hit','cut','cost','hurt',

  // Common regular past tense / past participle forms (-ed)
  'used','called','changed','moved','stopped','turned','asked','seemed','looked',
  'worked','played','wanted','needed','opened','closed','started','ended','helped',
  'reached','passed','stayed','named','joined','checked','waited','signed','added',
  'required','entered','removed','shared','viewed','liked','posted','updated',
  'fixed','tried','loved','moved','killed','raised','filled','saved','covered',
  'formed','produced','forced','limited','linked','ordered','created','designed',
  'based','known','given','seen','shown','written','taken','made','done','spoken',
  'broken','chosen','driven','fallen','grown','risen','worn','thrown',

  // Third-person singular present (-s/-es) — very common in articles and descriptions
  'goes','gets','makes','takes','sees','comes','knows','thinks','looks','wants',
  'gives','uses','finds','tells','asks','feels','tries','leaves','calls','keeps',
  'begins','shows','hears','plays','runs','moves','lives','believes','holds','brings',
  'writes','sits','stands','loses','pays','meets','includes','continues','sets',
  'learns','changes','leads','watches','follows','opens','walks','wins','offers',
  'considers','appears','buys','waits','serves','dies','sends','expects','builds',
  'stays','falls','cuts','reaches','remains','suggests','raises','passes','sells',
  'requires','reports','decides','pulls','breaks','speaks','eats','enters','stops',
  'adds','chooses','pushes','closes','spends','turns','starts','returns','explains',
  'develops','carries','draws','helps','grows','means','agrees','says','needs',

  // Irregular noun plurals & high-frequency plurals not derivable from base forms
  'people','children','men','women','years','days','things','times','ways','words',
  'places','weeks','months','hours','minutes','lives','hands','eyes','cars','books',
  'rooms','homes','areas','stories','facts','jobs','friends','cities','teams','names',
  'ideas','views','laws','actions','voices','states','schools','families','groups',
  'countries','problems','faces','roads','reasons','doors','tables','plans','hearts',
  'minds','moments','forms','forces','levels','ages','offices','courses','types',
  'pieces','fields','steps','costs','effects','deals','buildings','values','positions',
  'companies','systems','programs','questions','governments','nights','points','waters',
  'studies','sides','kinds','services','powers','games','lines','members','communities',
  'bodies','parties','results','needs','matters','markets','terms','processes',
  'differences','reports','buildings','relationships','decisions','taxes','prices',
  'experiences','rates','shows','chances','spaces','wars','pictures','risks',
  'projects','goals','features','solutions','challenges','strategies','benefits',
  'methods','conditions','factors','elements','aspects','sources','messages','records',
  'files','tasks','roles','stages','phases','paths','options','choices','skills',
  'resources','activities','opportunities','models','situations','agreements',
  'structures','orders','developments','environments','answers','details','qualities',
  'networks','products','users','performances','standards','practices','abilities',
  'categories','collections','connections','contexts','origins','purposes',
  'functions','responsibilities','clients','customers','audiences','institutions',
  'departments','agencies','committees','regulations','principles','beliefs',
  'concepts','theories','partners','numbers','images','sounds','levels','issues',
  'members','events','cases','rules','lines','articles','points','notes','lists',
  'tests','errors','requests','responses','pages','sections','chapters','examples',

  // Comparative & superlative adjectives
  'bigger','biggest','smaller','smallest','longer','longest','shorter','shortest',
  'older','oldest','newer','newest','higher','highest','lower','lowest','faster',
  'fastest','slower','slowest','easier','easiest','harder','hardest','stronger',
  'strongest','weaker','weakest','later','latest','earlier','earliest','wider',
  'widest','deeper','deepest','richer','richest','poorer','poorest','warmer','warmest',
  'cooler','coolest','brighter','brightest','darker','darkest','healthier','healthiest',
  'happier','happiest','sadder','saddest','safer','safest','closer','closest',
  'further','furthest','farther','farthest','quieter','quietest','louder','loudest',
  'cleaner','cleanest','heavier','heaviest','lighter','lightest','thicker','thickest',
  'thinner','thinnest','taller','tallest','shorter','shortest','younger','youngest',
  'simpler','simplest','stranger','strangest','fuller','fullest','emptier','emptiest',

  // Common web & UI vocabulary — words users encounter constantly on web pages
  'article','comment','reply','post','share','like','follow','subscribe','unsubscribe',
  'login','logout','signup','register','account','profile','settings','password',
  'username','email','search','filter','sort','view','edit','delete','save','cancel',
  'submit','send','upload','download','install','update','refresh','reload','back',
  'next','previous','close','open','menu','button','link','icon','image','photo',
  'video','audio','file','folder','page','site','blog','forum','chat','message',
  'notification','alert','error','warning','success','loading','processing',
  'available','unavailable','required','optional','private','public','free','paid',
  'new','popular','featured','recommended','related','similar','recent','latest',
  'trending','top','best','worst','rating','review','feedback','support','help',
  'contact','about','terms','privacy','cookie','policy','legal','copyright',

  // Business & professional
  'startup','entrepreneur','entrepreneurship','investor','investment','venture','capital',
  'funding','revenue','budget','forecast','quarterly','fiscal','stakeholder','shareholder',
  'dividend','merger','acquisition','subsidiary','franchise','brand','branding','marketing',
  'advertising','campaign','strategic','management','leadership','executive','director',
  'supervisor','coordinator','analyst','consultant','advisor','contractor','freelancer',
  'intern','bonus','commission','equity','pension','retirement','promotion','productivity',
  'deadline','milestone','deliverable','proposal','invoice','receipt','transaction',
  'purchase','shipment','supply','demand','competitor','segment','niche','vendor',
  'supplier','distributor','retailer','wholesaler','manufacturer','exporter','importer',
  'restructure','downsize','outsource','collaborate','negotiate','facilitate','delegate',
  'supervise','mentor','recruit','hire','allocate','sponsor','contribute','engage',
  'onboard','offboard','benchmark','prioritize','streamline','accelerate','monetize',
  'leverage','scale','pivot','iterate','prototype','launch','disrupt','innovate',
  'collaboration','negotiation','facilitation','delegation','recruitment','onboarding',
  'workflow','pipeline','roadmap','sprint','backlog','stakeholder','deliverable',
  'quarterly','revenue','overhead','margin','markup','breakeven','cashflow','valuation',
  'pitch','deck','traction','runway','bootstrapped','funded','profitable','viable',

  // Technology (expanded)
  'algorithm','database','server','cloud','endpoint','repository','branch','commit',
  'deployment','container','microservice','middleware','authentication','authorization',
  'encryption','payload','webhook','queue','thread','process','bandwidth','latency',
  'throughput','scalability','reliability','vulnerability','patch','version','release',
  'build','debug','log','monitor','metric','dashboard','analytics','interface',
  'frontend','backend','fullstack','mobile','desktop','browser','operating','system',
  'processor','graphics','keyboard','router','firewall','proxy','protocol','architecture',
  'staging','production','configuration','parameter','function','method','class',
  'object','array','string','integer','boolean','exception','regression','automation',
  'infrastructure','repository','kubernetes','docker','linux','microservices','devops',
  'agile','scrum','kanban','iteration','sprint','retrospective','standup','velocity',
  'debugging','refactoring','deployment','codebase','runtime','compile','syntax',
  'framework','library','dependency','package','module','component','plugin','extension',
  'webhook','API','REST','GraphQL','SDK','CLI','IDE','repository','merge','rebase',
  'feature','branch','release','hotfix','rollback','migration','schema','index',
  'query','transaction','backup','restore','replication','sharding','caching',
  'load','balancer','CDN','firewall','gateway','proxy','reverse','SSL','TLS','HTTPS',
  'OAuth','JWT','token','session','cookie','localStorage','encryption','hashing',
  'cybersecurity','breach','phishing','malware','ransomware','vulnerability','exploit',

  // Politics & news
  'election','campaign','candidate','ballot','primary','debate','poll','approval',
  'voter','turnout','constituency','senator','congressman','parliament','legislation',
  'amendment','constitution','democracy','republic','administration','cabinet','minister',
  'secretary','diplomat','ambassador','treaty','alliance','coalition','opposition',
  'majority','minority','bipartisan','liberal','conservative','moderate','progressive',
  'radical','reform','regulation','deregulation','sanction','tariff','embargo',
  'deficit','surplus','inflation','recession','unemployment','stimulus','bailout',
  'subsidy','spending','debt','crisis','protest','demonstration','rally','march',
  'strike','activist','advocacy','lobby','corruption','scandal','investigation',
  'impeachment','resignation','appointment','confirmation','nomination','inauguration',
  'summit','briefing','statement','announcement','speech','journalism','reporter',
  'correspondent','editor','headline','breaking','exclusive','editorial','op-ed',
  'propaganda','censorship','transparency','accountability','oversight','intelligence',
  'diplomat','foreign','domestic','bilateral','multilateral','geopolitical','sovereignty',
  'referendum','mandate','coalition','incumbent','challenger','poll','margin','swing',
  'democrat','republican','socialist','communist','libertarian','nationalist','populist',

  // Health & medicine
  'vaccine','vaccination','pandemic','epidemic','outbreak','virus','bacteria','infection',
  'contagion','immunity','antibody','antibiotic','prescription','medication','dosage',
  'diagnosis','prognosis','chronic','acute','terminal','rehabilitation','prevention',
  'screening','examination','biopsy','transplant','therapy','chemotherapy','radiation',
  'psychology','psychiatry','anxiety','depression','bipolar','autism','dementia',
  'alzheimer','stroke','cancer','tumor','diabetes','obesity','cardiovascular',
  'respiratory','neurological','genetic','hereditary','allergy','inflammation','immune',
  'autoimmune','clinical','trial','laboratory','pathology','anatomy','physiology',
  'nutrition','diet','wellness','meditation','mindfulness','quarantine','isolation',
  'ventilator','intensive','ambulance','paramedic','specialist','surgeon','physician',
  'pharmacist','therapist','counselor','pediatric','geriatric','psychiatric','oncology',
  'cardiology','neurology','orthopedic','dermatology','ophthalmology','gynecology',
  'telemedicine','telehealth','wearable','fitness','tracker','calories','protein',
  'carbohydrate','supplement','vitamin','mineral','antioxidant','probiotic','microbiome',
  'mental','emotional','behavioral','cognitive','developmental','chronic','acute',
  'preventive','palliative','holistic','alternative','conventional','evidence-based',

  // Entertainment & media
  'movie','film','series','episode','sequel','prequel','actor','actress','director',
  'producer','screenplay','script','character','plot','genre','comedy','drama',
  'thriller','horror','action','romance','documentary','animation','streaming',
  'premiere','trailer','critic','award','nomination','festival','performance','concert',
  'album','track','playlist','podcast','broadcast','channel','studio','label',
  'songwriter','composer','conductor','orchestra','exhibition','gallery','museum',
  'theater','ballet','opera','celebrity','influencer','entertainment','blockbuster',
  'franchise','reboot','remake','adaptation','cinematography','soundtrack','score',
  'narrative','protagonist','antagonist','plot','twist','climax','resolution','arc',
  'binge','watch','review','spoiler','reaction','commentary','critique','analysis',
  'subscription','streaming','platform','original','exclusive','release','premiere',

  // Sports & fitness
  'athlete','coach','trainer','referee','umpire','championship','tournament','league',
  'division','conference','fixture','assist','penalty','foul','offside','tackle',
  'dribble','sprint','hurdle','marathon','triathlon','swimming','cycling','boxing',
  'wrestling','gymnastics','martial','baseball','basketball','football','soccer',
  'volleyball','tennis','golf','rugby','cricket','hockey','skiing','snowboarding',
  'surfing','skateboarding','olympics','paralympic','medal','trophy','stadium','arena',
  'court','pitch','track','gym','workout','training','strength','cardio','endurance',
  'flexibility','recovery','injury','physiotherapy','doping','sponsorship','transfer',
  'contract','signing','draft','playoff','semifinal','final','overtime','shootout',
  'record','personal','world','national','qualifying','seeding','ranking','standings',

  // Science & research
  'hypothesis','experiment','observation','evidence','conclusion','theory','discovery',
  'innovation','engineering','physics','chemistry','biology','astronomy','geology',
  'ecology','sociology','statistics','calculus','algebra','geometry','logic',
  'methodology','procedure','variable','control','sample','population','correlation',
  'causation','peer','publication','journal','citation','abstract','introduction',
  'microscope','telescope','simulation','prediction','uncertainty','probability',
  'quantum','relativity','evolution','genetics','genome','molecule','atom','electron',
  'neutron','proton','particle','wave','frequency','amplitude','spectrum','reaction',
  'compound','element','periodic','organic','inorganic','polymer','crystal','plasma',
  'temperature','pressure','velocity','acceleration','gravity','momentum',
  'biodiversity','ecosystem','habitat','species','extinction','conservation','fossil',
  'carbon','oxygen','hydrogen','nitrogen','climate','atmosphere','ozone','emissions',
  'renewable','sustainable','solar','wind','nuclear','fossil','fuel','geothermal',
  'nanotechnology','biotechnology','artificial','intelligence','machine','learning',
  'neural','network','deep','reinforcement','supervised','unsupervised','dataset',
  'training','inference','model','accuracy','precision','recall','benchmark','evaluation',

  // Legal & financial
  'attorney','lawyer','judge','verdict','sentence','appeal','plaintiff','defendant',
  'witness','testimony','clause','liability','negligence','damages','compensation',
  'settlement','arbitration','mediation','compliance','audit','disclosure','fraud',
  'theft','copyright','trademark','patent','license','permit','mortgage','loan',
  'credit','interest','bond','yield','portfolio','diversification','hedge','insurance',
  'premium','deductible','claim','beneficiary','estate','inheritance','trust','executor',
  'bankruptcy','liquidation','collateral','guarantee','warranty','indemnity',
  'jurisdiction','precedent','statute','ordinance','malpractice','injunction',
  'subpoena','deposition','litigation','prosecution','acquittal','probation','parole',
  'felony','misdemeanor','infringement','intellectual','property','trademark',
  'incorporation','llc','corporation','partnership','sole','proprietorship',
  'accounting','bookkeeping','depreciation','amortization','asset','liability',
  'equity','balance','sheet','income','statement','cashflow','dividend','capital',
  'gains','loss','deduction','exemption','withholding','quarterly','filing',

  // Social media & digital culture
  'hashtag','viral','meme','thread','mention','handle','avatar','bio','unfollow',
  'block','report','retweet','reaction','dm','timeline','algorithm','reach',
  'impression','engagement','conversion','bounce','traffic','SEO','keyword',
  'ranking','backlink','domain','hosting','analytics','funnel','landing','checkout',
  'cart','wishlist','recommendation','testimonial','unboxing','tutorial','walkthrough',
  'livestream','webinar','newsletter','paywall','freemium','crowdfunding','affiliate',
  'referral','coupon','discount','promo','deal','clickbait','sponsored','ad','native',
  'influencer','creator','content','monetize','niche','audience','persona','brand',
  'collab','partnership','campaign','viral','organic','paid','earned','owned',
  'community','moderation','toxic','troll','bot','spam','fake','misinformation',

  // Travel & geography
  'destination','itinerary','reservation','accommodation','hostel','hotel','resort',
  'motel','airbnb','passport','visa','customs','immigration','departure','arrival',
  'terminal','gate','boarding','layover','connection','transfer','currency','exchange',
  'tourist','traveler','backpacker','cruise','safari','expedition','adventure','tour',
  'guide','map','navigation','directions','landmark','attraction','sightseeing',
  'monument','castle','cathedral','temple','mosque','shrine','ruins','heritage',
  'continent','region','province','territory','capital','suburb','downtown','urban',
  'rural','coastal','inland','tropical','arctic','equatorial','mediterranean',
  'altitude','longitude','latitude','climate','timezone','local','abroad','overseas',
  'international','domestic','border','crossing','checkpoint','quarantine',

  // Education (expanded)
  'curriculum','syllabus','semester','trimester','tuition','scholarship','fellowship',
  'dissertation','thesis','undergraduate','graduate','postgraduate','doctorate','phd',
  'bachelor','master','diploma','certificate','credential','accreditation','enrollment',
  'admission','application','interview','recommendation','essay','portfolio','transcript',
  'gpa','grade','pass','fail','distinction','honor','academic','classroom','lecture',
  'seminar','tutorial','workshop','laboratory','experiment','assignment','project',
  'presentation','examination','assessment','feedback','rubric','criteria','objective',
  'outcome','competency','literacy','numeracy','critical','thinking','creativity',
  'collaboration','communication','digital','literacy','stem','humanities','philosophy',

  // Nature & environment
  'ecosystem','biodiversity','habitat','species','wildlife','mammal','reptile','amphibian',
  'insect','bird','plant','tree','flower','grass','fungus','bacteria','virus',
  'predator','prey','migration','hibernation','photosynthesis','pollination','seed',
  'soil','sand','clay','mineral','crystal','volcano','earthquake','tsunami','tornado',
  'hurricane','drought','flood','wildfire','erosion','glacier','iceberg','coral',
  'reef','wetland','desert','savanna','rainforest','tundra','prairie','meadow',
  'conservation','preservation','sustainability','renewable','emission','pollution',
  'recycling','waste','contamination','toxic','biodegradable','carbon','footprint',
  'greenhouse','ozone','deforestation','reforestation','rewilding','endangered',

  // More verbs not yet covered
  'achieve','accomplish','implement','execute','deploy','configure','optimize','monitor',
  'analyze','evaluate','assess','prioritize','coordinate','communicate','collaborate',
  'negotiate','facilitate','mediate','arbitrate','advocate','lobby','campaign','protest',
  'demonstrate','march','strike','petition','volunteer','donate','fundraise','sponsor',
  'recruit','hire','train','promote','transfer','retire','resign','quit','fire',
  'outsource','subcontract','franchise','license','patent','trademark','copyright',
  'audit','inspect','investigate','prosecute','defend','appeal','settle','mediate',
  'diagnose','prescribe','treat','cure','vaccinate','quarantine','isolate','test',
  'screen','examine','operate','transplant','rehabilitate','recover','heal',
  'stream','broadcast','publish','distribute','circulate','syndicate','archive',
  'curate','moderate','censor','edit','revise','proofread','translate','interpret',
  'authenticate','authorize','encrypt','decrypt','hash','tokenize','validate',
  'migrate','replicate','synchronize','backup','restore','archive','compress','extract',
  'visualize','render','animate','simulate','model','prototype','iterate','test',
  'benchmark','profile','trace','log','monitor','alert','notify','automate','schedule',
  'trigger','invoke','execute','terminate','suspend','resume','pause','restart',

  // More adjectives not yet covered
  'innovative','collaborative','comprehensive','transparent','sustainable','scalable',
  'robust','flexible','modular','iterative','productive','profitable','viable',
  'feasible','affordable','accessible','inclusive','diverse','equitable','authentic',
  'genuine','credible','reputable','established','emerging','competitive','dominant',
  'mainstream','premium','enterprise','commercial','industrial','governmental',
  'nonprofit','charitable','voluntary','mandatory','optional','supplementary',
  'preliminary','provisional','interim','permanent','temporary','seasonal','annual',
  'weekly','monthly','daily','hourly','real-time','instant','delayed','scheduled',
  'automated','manual','hybrid','integrated','standalone','distributed','centralized',
  'decentralized','federated','open','closed','proprietary','open-source',
  'encrypted','secure','vulnerable','exposed','protected','restricted','classified',
  'confidential','sensitive','public','anonymous','pseudonymous','identifiable',
  'verified','unverified','certified','accredited','licensed','registered','regulated',
  'unregulated','compliant','non-compliant','approved','pending','rejected','archived',
  'deprecated','obsolete','legacy','modern','contemporary','cutting-edge','state-of-the-art',
  'groundbreaking','unprecedented','revolutionary','evolutionary','incremental',
  'disruptive','transformative','impactful','meaningful','measurable','quantifiable',

  // More -ing forms (professional & domain verbs)
  'achieving','accomplishing','implementing','executing','deploying','configuring',
  'optimizing','monitoring','analyzing','evaluating','assessing','prioritizing',
  'coordinating','communicating','collaborating','negotiating','facilitating',
  'advocating','lobbying','campaigning','protesting','demonstrating','volunteering',
  'donating','fundraising','sponsoring','recruiting','hiring','training','promoting',
  'outsourcing','franchising','licensing','patenting','auditing','inspecting',
  'investigating','prosecuting','defending','appealing','settling','diagnosing',
  'prescribing','treating','vaccinating','quarantining','isolating','screening',
  'operating','rehabilitating','recovering','healing','streaming','broadcasting',
  'publishing','distributing','curating','moderating','editing','translating',
  'authenticating','authorizing','encrypting','migrating','replicating','backing',
  'restoring','archiving','compressing','visualizing','rendering','animating',
  'simulating','modeling','benchmarking','profiling','tracing','logging','alerting',
  'notifying','automating','scheduling','triggering','invoking','terminating',
  'suspending','resuming','pausing','restarting','scaling','refactoring','debugging',

  // More -ed forms (professional & domain verbs)
  'achieved','accomplished','implemented','executed','deployed','configured','optimized',
  'monitored','analyzed','evaluated','assessed','prioritized','coordinated','communicated',
  'collaborated','negotiated','facilitated','advocated','lobbied','campaigned','protested',
  'volunteered','donated','fundraised','sponsored','recruited','hired','trained','promoted',
  'outsourced','franchised','licensed','patented','audited','inspected','investigated',
  'prosecuted','defended','appealed','settled','diagnosed','prescribed','treated',
  'vaccinated','quarantined','isolated','screened','operated','rehabilitated','healed',
  'streamed','broadcast','published','distributed','curated','moderated','edited',
  'translated','authenticated','authorized','encrypted','migrated','replicated',
  'archived','compressed','visualized','rendered','animated','simulated','modeled',
  'benchmarked','profiled','traced','logged','alerted','notified','automated',
  'scheduled','triggered','invoked','terminated','suspended','resumed','restarted',
  'scaled','refactored','debugged','launched','funded','acquired','merged','restructured',

  // Common compound / collocations used as standalone words on the web
  'healthcare','cybersecurity','cryptocurrency','blockchain','fintech','edtech',
  'healthtech','cleantech','biotech','nanotech','aerospace','automotive','ecommerce',
  'marketplace','platform','ecosystem','framework','methodology','infrastructure',
  'architecture','governance','compliance','transparency','accountability','sustainability',
  'diversity','inclusion','belonging','accessibility','usability','reliability',
  'affordability','availability','scalability','interoperability','compatibility',
  'backward','forward','downtime','uptime','offboarding','onboarding','crowdsource',
  'open-source','open-access','peer-to-peer','end-to-end','real-time','near-real-time',
  'full-time','part-time','freelance','remote','hybrid','onsite','in-person','virtual',
  'synchronous','asynchronous','self-paced','instructor-led','blended','cohort',
  'subscription','membership','tier','plan','upgrade','downgrade','trial','freemium',
  'paywall','checkout','cart','wishlist','bundle','package','add-on','integration',

  // Countries & territories (commonly translated on news/travel pages)
  'afghanistan','albania','algeria','angola','argentina','armenia','australia','austria',
  'azerbaijan','bahrain','bangladesh','belarus','belgium','bolivia','brazil','bulgaria',
  'cambodia','cameroon','canada','chile','china','colombia','croatia','cuba','cyprus',
  'czechia','denmark','ecuador','egypt','ethiopia','finland','france','georgia',
  'ghana','greece','guatemala','honduras','hungary','iceland','india','indonesia',
  'iran','iraq','ireland','israel','italy','jamaica','japan','jordan','kazakhstan',
  'kenya','kuwait','kyrgyzstan','laos','latvia','lebanon','libya','lithuania',
  'luxembourg','malaysia','mexico','moldova','mongolia','morocco','mozambique',
  'myanmar','namibia','nepal','netherlands','nicaragua','nigeria','norway','pakistan',
  'panama','paraguay','peru','philippines','poland','portugal','qatar','romania',
  'russia','rwanda','saudi','senegal','serbia','singapore','slovakia','slovenia',
  'somalia','spain','sudan','sweden','switzerland','syria','taiwan','tajikistan',
  'tanzania','thailand','tunisia','turkey','uganda','ukraine','uruguay','uzbekistan',
  'venezuela','vietnam','yemen','zimbabwe',

  // Nationalities & demonyms (appear constantly in news and web content)
  'american','british','french','german','spanish','italian','portuguese','dutch',
  'russian','chinese','japanese','korean','arabic','hindi','swedish','norwegian',
  'danish','finnish','polish','romanian','hungarian','czech','slovak','greek',
  'turkish','persian','hebrew','thai','vietnamese','indonesian','malay','bengali',
  'ukrainian','bulgarian','serbian','croatian','slovenian','latvian','lithuanian',
  'estonian','irish','scottish','welsh','canadian','australian','mexican','brazilian',
  'argentinian','colombian','chilean','peruvian','venezuelan','cuban','jamaican',
  'nigerian','kenyan','ethiopian','egyptian','moroccan','algerian','tunisian',
  'ghanaian','south','african','congolese','tanzanian','ugandan','rwandan',
  'pakistani','bangladeshi','nepali','sri','lankan','afghan','iranian','iraqi',
  'syrian','lebanese','jordanian','kuwaiti','saudi','emirati','qatari','bahraini',
  'israeli','indian','singaporean','filipino','cambodian','laotian','burmese',
  'mongolian','kazakh','uzbek','azerbaijani','armenian','georgian','moldovan',

  // Common adjective phrases / standalone descriptors seen on web pages
  'award-winning','well-known','high-quality','low-cost','full-featured','user-friendly',
  'cutting-edge','state-of-the-art','best-in-class','world-class','industry-leading',
  'fast-growing','high-performing','data-driven','cloud-based','web-based','mobile-first',
  'open-source','cross-platform','multi-platform','real-time','on-demand','subscription-based',
  'evidence-based','research-backed','peer-reviewed','fact-checked','bias-free',
  'family-friendly','child-safe','adult-only','age-restricted','region-locked',
  'time-sensitive','high-priority','low-priority','mission-critical','business-critical',
  'cost-effective','resource-intensive','labor-intensive','capital-intensive','scalable',
  'backward-compatible','forward-compatible','plug-and-play','out-of-the-box',

  // Finance & economics (expanded)
  'macroeconomics','microeconomics','monetary','fiscal','quantitative','easing','tightening',
  'interest','rate','inflation','deflation','stagflation','hyperinflation','recession',
  'depression','recovery','growth','contraction','expansion','boom','bust','cycle',
  'gdp','gnp','unemployment','employment','workforce','labor','productivity','output',
  'consumption','expenditure','investment','savings','deficit','surplus','debt','credit',
  'liquidity','solvency','insolvency','default','restructuring','austerity','stimulus',
  'quantitative','monetary','fiscal','policy','central','reserve','treasury','mint',
  'currency','exchange','rate','appreciation','depreciation','devaluation','revaluation',
  'volatility','hedge','speculation','arbitrage','derivative','futures','options',
  'commodity','equities','bonds','securities','assets','liabilities','net-worth',
  'portfolio','diversification','correlation','risk','return','yield','coupon',
  'maturity','duration','rating','downgrade','upgrade','outlook','forecast','projection',
  'revenue','earnings','profit','loss','margin','ebitda','operating','net','gross',
  'quarterly','annual','guidance','consensus','beat','miss','surprise','analyst',

  // Marketing & communications
  'branding','positioning','differentiation','segmentation','targeting','persona',
  'funnel','awareness','consideration','conversion','retention','loyalty','advocacy',
  'impression','click','engagement','reach','frequency','attribution','touchpoint',
  'copywriting','messaging','narrative','storytelling','content','inbound','outbound',
  'organic','paid','earned','media','channel','omnichannel','multichannel','cross-channel',
  'email','social','search','display','programmatic','influencer','affiliate',
  'retargeting','remarketing','personalization','segmentation','automation','nurture',
  'lead','prospect','opportunity','pipeline','quota','forecast','close','churn',
  'acquisition','retention','lifetime','value','cost','per','click','impression',
  'conversion','rate','return','ad','spend','cost','acquisition','payback','period',

  // Human resources & organizational
  'recruitment','talent','acquisition','onboarding','offboarding','retention','turnover',
  'attrition','headcount','capacity','planning','succession','performance','management',
  'compensation','benefits','total','rewards','equity','diversity','belonging',
  'wellbeing','engagement','satisfaction','experience','development','learning',
  'reskilling','upskilling','mentoring','coaching','feedback','review','appraisal',
  'objective','key','result','goal','alignment','culture','values','mission','vision',
  'org','chart','hierarchy','flat','matrix','cross-functional','agile','team',
  'remote','hybrid','distributed','co-located','flexible','work','arrangement',
  'leave','parental','maternity','paternity','sick','vacation','sabbatical','break',
  'harassment','discrimination','unconscious','bias','privilege','allyship',
  'whistleblower','grievance','mediation','arbitration','termination','severance',

  // Product & design
  'ux','ui','product','design','user','experience','interface','interaction','visual',
  'information','architecture','wireframe','mockup','prototype','usability','testing',
  'accessibility','inclusive','responsive','adaptive','mobile','desktop','tablet',
  'typography','hierarchy','layout','grid','spacing','color','palette','contrast',
  'affordance','discoverability','onboarding','flow','journey','map','persona',
  'empathy','research','insight','hypothesis','experiment','validate','iterate',
  'sprint','design','thinking','lean','agile','waterfall','kanban','scrum',
  'backlog','prioritization','roadmap','milestone','release','launch','post-launch',
  'metrics','kpi','north-star','vanity','actionable','leading','lagging','indicator',

  // Common news & journalism vocabulary
  'breaking','exclusive','developing','confirmed','alleged','reportedly','sources',
  'anonymous','on-record','background','embargo','retraction','correction','update',
  'byline','dateline','lede','headline','subheading','caption','pullquote','sidebar',
  'op-ed','column','editorial','opinion','analysis','investigation','feature','profile',
  'interview','press','conference','briefing','statement','release','spokesperson',
  'attribution','credibility','bias','objectivity','balance','fact-checking','verification',
  'primary','secondary','source','document','leak','whistleblower','anonymous','tip',
  'circulation','readership','pageview','engagement','subscription','paywall','premium',

  // Everyday nouns commonly found on web pages but not yet covered
  'picture','caption','screenshot','thumbnail','banner','poster','flyer','brochure',
  'catalog','catalog','manual','handbook','guidebook','glossary','index','appendix',
  'footnote','citation','reference','bibliography','abstract','executive','summary',
  'introduction','overview','background','methodology','findings','conclusion',
  'recommendation','action','item','takeaway','insight','lesson','tip','trick','hack',
  'shortcut','workaround','solution','fix','patch','update','upgrade','migration',
  'transition','transformation','change','shift','trend','pattern','theme','topic',
  'subject','area','field','discipline','domain','specialty','expertise','niche',
  'segment','market','industry','vertical','horizontal','adjacent','complementary',

  // Verbs commonly found on web pages (imperatives & infinitives in CTAs, instructions)
  'click','tap','swipe','scroll','hover','drag','drop','pinch','zoom','rotate',
  'navigate','browse','explore','discover','learn','read','watch','listen','play',
  'pause','stop','skip','rewind','fast-forward','replay','loop','shuffle','repeat',
  'share','copy','paste','cut','undo','redo','select','highlight','mark','bookmark',
  'print','export','import','convert','compress','extract','unzip','rename','move',
  'resize','crop','trim','merge','split','sort','group','tag','label','categorize',
  'archive','restore','recover','reset','clear','flush','purge','wipe','format',
  'activate','deactivate','enable','disable','toggle','switch','flip','lock','unlock',
  'verify','confirm','acknowledge','accept','decline','reject','dismiss','ignore',
  'approve','deny','grant','revoke','suspend','terminate','renew','extend','expire',

  // More common adjectives for web content
  'featured','sponsored','promoted','boosted','pinned','highlighted','starred','flagged',
  'verified','certified','official','authentic','legitimate','genuine','trusted','safe',
  'secure','encrypted','protected','private','anonymous','incognito','hidden','visible',
  'published','unpublished','draft','archived','deleted','removed','banned','blocked',
  'approved','rejected','pending','processing','queued','scheduled','delayed','canceled',
  'completed','finished','done','closed','resolved','fixed','patched','updated',
  'outdated','deprecated','legacy','classic','vintage','retro','nostalgic','timeless',
  'limited','exclusive','special','rare','unique','custom','bespoke','tailored',
  'personalized','curated','handpicked','recommended','suggested','relevant','targeted',
  'contextual','dynamic','static','responsive','adaptive','flexible','rigid',
  'lightweight','heavyweight','compact','portable','handheld','wearable','embedded',

  // Common everyday English words not yet covered
  'ability','absence','access','accident','achievement','action','activity','addition',
  'address','administration','advantage','adventure','advice','affect','afternoon',
  'agency','agent','agreement','aim','airport','allowance','alternative','analysis',
  'announcement','anxiety','appearance','application','appointment','appreciation',
  'approach','argument','arrangement','arrival','aspect','assistance','association',
  'assumption','atmosphere','attachment','attempt','attitude','attraction','availability',
  'awareness','balance','barrier','basis','behavior','benefit','boundary','capacity',
  'capability','celebration','certainty','circumstance','citizenship','clarity',
  'collection','commitment','communication','community','comparison','compassion',
  'competition','complexity','concern','confidence','conflict','consciousness',
  'conservation','consideration','consistency','contribution','controversy','convenience',
  'conversation','cooperation','copyright','creation','creativity','criticism',
  'curiosity','democracy','demonstration','dependence','description','determination',
  'dialogue','difficulty','direction','disadvantage','disagreement','discipline',
  'discussion','distinction','diversity','documentation','effectiveness','efficiency',
  'elimination','emotion','emphasis','equality','establishment','estimation','exception',
  'existence','expansion','expectation','explanation','expression','extension',
  'flexibility','formation','foundation','freedom','frequency','friendship','fulfillment',
  'functionality','globalization','happiness','identification','illustration',
  'imagination','independence','indication','influence','information','instruction',
  'intention','interpretation','introduction','investigation','involvement','isolation',
  'justification','liberation','limitation','location','maintenance','measurement',
  'modification','motivation','movement','navigation','necessity','observation',
  'organization','orientation','participation','patience','percentage','perception',
  'persistence','perspective','population','possibility','potential','preference',
  'preparation','presentation','priority','probability','productivity','profession',
  'progression','protection','provision','qualification','recognition','recommendation',
  'reduction','reflection','relationship','representation','requirement','resistance',
  'resolution','responsibility','restriction','satisfaction','separation','significance',
  'simplicity','situation','specification','stability','strategy','strength','structure',
  'submission','suggestion','sustainability','transparency','understanding','uniqueness',
  'variation','verification','vulnerability','weakness','willingness',

  // Common phrasal verbs & particle verbs (appear as distinct words on web)
  'breakout','breakthrough','breakdown','buildup','burnout','buyout','callback','carryout',
  'catchup','checkout','cleanup','closeout','comeback','cutback','cutout','drawback',
  'dropdown','fallback','followup','giveaway','handout','hangup','holdup','keepout',
  'kickoff','knockoff','lockdown','lockout','lookup','makeup','markdown','meetup',
  'meltdown','outlook','output','overcrowded','overdue','overfull','overlap','overload',
  'overrun','overthrow','overview','packaged','passout','payout','pickup','plugin',
  'printout','pullout','pushback','readout','rollout','roundup','rundown','runoff',
  'sellout','setback','setup','shutdown','signin','signup','slowdown','speedup',
  'spillover','spinoff','standout','standby','startup','stopover','takeover','takeout',
  'timeout','tradeoff','turnout','turnover','update','upgrade','uptick','workaround',

  // More common nouns (gap-filling)
  'abundance','accountability','accuracy','achievement','acknowledgment','acquisition',
  'adaptation','addition','adequacy','adjustment','admission','adoption','advancement',
  'affiliation','affirmation','aftermath','agenda','allocation','ambiguity','ambition',
  'analogy','appeal','applicability','appreciation','appropriateness','aptitude',
  'assertion','assessment','assignment','assurance','authenticity','authorization',
  'benchmark','breadth','breakdown','breakthrough','capacity','clarity','coherence',
  'collaboration','commitment','competence','complexity','comprehension','concentration',
  'confirmation','conformity','contradiction','coordination','correspondence',
  'credibility','critique','currency','dedication','depth','designation','detail',
  'determination','differentiation','disclosure','discrepancy','distribution','economy',
  'elaboration','empowerment','endorsement','enhancement','enrollment','entitlement',
  'equivalence','escalation','evaluation','examination','exclusion','execution',
  'exemption','exhaustion','expectation','expertise','exposure','extent','facilitation',
  'familiarity','flexibility','guidance','implementation','improvement','inclusion',
  'inconsistency','independence','indication','initiative','integration','integrity',
  'interaction','interdependence','interpretation','intervention','introduction',
  'judgment','justification','leadership','leverage','limitation','maintenance',
  'manifestation','mechanism','methodology','modification','monitoring','momentum',
  'navigation','negotiation','objective','obligation','observation','occurrence',
  'optimization','orientation','oversight','participation','persistence','placement',
  'precision','preparation','preservation','prioritization','projection','qualification',
  'rationalization','realization','recognition','reconciliation','reinforcement',
  'relevance','representation','resilience','retention','scalability','scope',
  'sensitivity','significance','specification','standardization','submission',
  'sustainability','tolerance','traceability','transformation','transparency','trust',
  'uncertainty','utilization','validation','viability','visibility','vulnerability',

  // More verb forms (gerunds of common professional actions)
  'addressing','advancing','allocating','analyzing','anticipating','applying',
  'assessing','assigning','assisting','assuming','attributing','auditing',
  'authorizing','automating','benchmarking','building','calculating','categorizing',
  'challenging','characterizing','classifying','collaborating','combining',
  'communicating','compensating','complying','computing','confirming','consolidating',
  'constructing','consulting','contributing','controlling','coordinating','correcting',
  'creating','customizing','defining','demonstrating','designing','detecting',
  'determining','developing','documenting','driving','enabling','enforcing',
  'establishing','estimating','evaluating','executing','expanding','explaining',
  'exploring','filtering','formatting','generating','governing','guiding',
  'identifying','implementing','improving','incorporating','increasing','indicating',
  'influencing','informing','integrating','interpreting','investigating','leading',
  'maintaining','managing','measuring','migrating','mitigating','modeling',
  'monitoring','navigating','notifying','obtaining','optimizing','organizing',
  'outlining','overseeing','performing','planning','preparing','presenting',
  'prioritizing','processing','providing','publishing','qualifying','quantifying',
  'recommending','recording','reducing','reporting','researching','resolving',
  'reviewing','revising','scheduling','securing','selecting','simplifying',
  'streamlining','structuring','summarizing','supporting','transforming','translating',
  'troubleshooting','updating','validating','verifying','visualizing',

  // Technology (additional terms)
  'agility','alignment','allocation','analytics','annotation','anonymization',
  'archiving','assertion','augmentation','automation','availability','baseline',
  'batching','bottleneck','caching','checksum','clustering','codegen','compression',
  'concurrency','containerization','continuous','delivery','integration','deployment',
  'crawling','cryptography','deduplication','dependency','deserialization','detection',
  'distributed','edge','embedding','encryption','enumeration','federation','fingerprint',
  'garbage','collection','horizontal','vertical','scaling','idempotent','immutable',
  'indexing','instrumentation','isolation','iteration','linting','liveness','probe',
  'load','testing','logging','marshaling','memoization','messaging','namespacing',
  'observability','orchestration','pagination','parallelism','parsing','persistence',
  'polling','pub-sub','queue','race','condition','rate-limiting','reconciliation',
  'redundancy','regression','resilience','retry','rollback','routing','sampling',
  'sandboxing','serialization','serverless','sharding','sidecar','single-sign-on',
  'snapshot','state','machine','throttling','tracing','idempotency','versioning',

  // Common online shopping & commerce vocabulary
  'bestseller','clearance','closeout','comparison','coupon','currency','customer',
  'delivery','discount','dispatch','exchange','express','fulfillment','guarantee',
  'inventory','marketplace','merchant','offer','original','outlet','packaging',
  'payment','promotion','protection','purchase','quantity','refund','return','review',
  'sale','seller','shipment','shipping','sku','stock','store','tracking','transaction',
  'vendor','verified','warranty','wholesale','wishlist','buyer','seller','bidding',
  'auction','reserve','buyout','negotiable','fixed','variable','flexible',
]

const uniqueWords = [...new Set(WORDS.map(w => w.toLowerCase()))]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function translateBatch(words, langCode, attempt = 0) {
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
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) {
      const text = await res.text()
      throw new Error(`Azure error ${res.status} after ${MAX_RETRIES} retries: ${text}`)
    }
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
    const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(15000 * 2 ** attempt, 120000)
    process.stdout.write(` [rate limited, waiting ${backoff / 1000}s...]`)
    await sleep(backoff)
    return translateBatch(words, langCode, attempt + 1)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Azure error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return words.map((word, i) => ({ word, translation: data[i]?.translations?.[0]?.text ?? null }))
}

async function seedLanguage(langCode, langName) {
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
    if (i + BATCH_SIZE < uniqueWords.length) await sleep(INTER_BATCH_DELAY_MS)
  }

  const lines = [
    `-- ${langName} (${langCode}) seed translations for Osmosis`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Words: ${pairs.length}`,
    '',
  ]

  // 2 years — static seeds should never expire silently
  const SEED_TTL_SECS = 2 * 365 * 24 * 60 * 60

  for (let i = 0; i < pairs.length; i += SQL_CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + SQL_CHUNK_SIZE)
    const values = chunk
      .map(({ word, translation }) => {
        const w = word.replace(/'/g, "''")
        const t = translation.replace(/'/g, "''")
        return `  ('${w}', '${langCode}', '${t}', 0, unixepoch() + ${SEED_TTL_SECS})`
      })
      .join(',\n')
    lines.push(
      'INSERT INTO translation_cache (word, target_lang, translation, hit_count, expires_at) VALUES',
      `${values}`,
      `ON CONFLICT(word, target_lang) DO UPDATE SET expires_at = MAX(translation_cache.expires_at, excluded.expires_at);`,
      '',
    )
  }

  console.log(`  [${langCode}] ${pairs.length} translations ready`)
  return { lines, pairs, langCode }
}

function applyToD1(sqlFile) {
  console.log(`\nApplying ${sqlFile} to D1...`)
  execSync(`npx wrangler d1 execute osmosis --file=${sqlFile} --remote`, { stdio: 'inherit' })
  console.log(`Done.`)
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

  if (!LANGUAGES[arg] && arg !== 'all') {
    console.error(`Unknown language: ${arg}`)
    console.error(`Available: ${Object.keys(LANGUAGES).join(', ')}`)
    process.exit(1)
  }

  if (arg === 'all') {
    // Translate all languages, combine into one SQL file, apply once
    const combinedLines = [
      `-- All languages seed translations for Osmosis`,
      `-- Generated: ${new Date().toISOString()}`,
      `-- Languages: ${Object.keys(LANGUAGES).join(', ')}`,
      '',
    ]
    let totalPairs = 0
    const langEntries = Object.entries(LANGUAGES)
    for (let i = 0; i < langEntries.length; i++) {
      const [code, name] = langEntries[i]
      const { lines, pairs } = await seedLanguage(code, name)
      combinedLines.push(...lines)
      totalPairs += pairs.length
      if (i < langEntries.length - 1) {
        console.log(`  Waiting ${INTER_LANGUAGE_DELAY_MS / 1000}s before next language...`)
        await sleep(INTER_LANGUAGE_DELAY_MS)
      }
    }
    const outputFile = 'seed_all.sql'
    writeFileSync(outputFile, combinedLines.join('\n'), 'utf8')
    console.log(`\nWrote ${outputFile} (${totalPairs} total translations across ${Object.keys(LANGUAGES).length} languages)`)
    applyToD1(outputFile)
  } else {
    // Single language: write per-language file and apply
    const { lines, pairs, langCode } = await seedLanguage(arg, LANGUAGES[arg])
    const outputFile = `seed_${langCode.replace('-', '_')}.sql`
    writeFileSync(outputFile, lines.join('\n'), 'utf8')
    console.log(`\nWrote ${outputFile} (${pairs.length} translations)`)
    applyToD1(outputFile)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
