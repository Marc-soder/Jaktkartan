// Bygger database.rules.json för Firebase Realtime Database.
const G = "'groups/'+$gid";
const me = `root.child(${G}+'/members/'+auth.uid)`;
const signed = 'auth != null';
const isMember = `(${signed} && ${me}.exists())`;
const role = `${me}.child('role').val()`;
const isAdmin = `(${signed} && ${role} === 'admin')`;
const canLead = `(${signed} && (${role} === 'admin' || ${role} === 'leader'))`;
const canEdit = `(${signed} && (${role} === 'admin' || ${role} === 'leader' || ${role} === 'editor'))`;
const guest = `root.child(${G}+'/guests/'+auth.uid)`;
const isGuest = `(${signed} && ${guest}.child('expires').val() > now)`;
const guestArea = `(${isGuest} && root.child(${G}+'/hunts/'+${guest}.child('hid').val()+'/areas/'+$aid).val() === true)`;
const adminOf = g => `root.child('groups/'+${g}+'/members/'+auth.uid+'/role').val() === 'admin'`;
const leadOf = g => `(root.child('groups/'+${g}+'/members/'+auth.uid+'/role').val() === 'admin' || root.child('groups/'+${g}+'/members/'+auth.uid+'/role').val() === 'leader')`;
const owner = `data.parent().parent().child('meta/owner').val()`;
const invite = `root.child('invites/'+newData.child('code').val())`;
const hunt = `root.child(${G}+'/hunts/'+$hid)`;
// Jakten pågår: sluttiden har inte passerat och starttiden (om den finns) har passerat.
const huntLive = `(${hunt}.child('expires').val() > now && (!${hunt}.child('starts').exists() || ${hunt}.child('starts').val() <= now))`;
const hcode = `root.child('huntCodes/'+newData.child('code').val())`;

const rules = { rules: {
  '.read': false, '.write': false,
  owner: { '.read': signed, '.write': `${signed} && !data.exists() && newData.val() === auth.uid && auth.token.firebase.sign_in_provider !== 'anonymous'` },
  creators: { '$uid': { '.read': `${signed} && (auth.uid === $uid || root.child('owner').val() === auth.uid)`, '.write': `${signed} && root.child('owner').val() === auth.uid`, '.validate': 'newData.isBoolean()' } },
  userGroups: { '$uid': { '.read': `${signed} && auth.uid === $uid`, '.write': `${signed} && auth.uid === $uid` } },
  invites: { '$code': {
    '.read': signed,
    '.write': `${signed} && ((!data.exists() && ${adminOf("newData.child('gid').val()")}) || (data.exists() && !newData.exists() && ${adminOf("data.child('gid').val()")}))`,
    '.validate': `$code.length >= 8 && newData.hasChildren(['gid','role','expires']) && newData.child('expires').isNumber() && (newData.child('role').val() === 'leader' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer')`
  } },
  huntCodes: { '$code': {
    '.read': signed,
    '.write': `${signed} && ((!data.exists() && ${leadOf("newData.child('gid').val()")}) || (data.exists() && !newData.exists() && ${leadOf("data.child('gid').val()")}))`,
    '.validate': `$code.length >= 6 && newData.hasChildren(['gid','hid','expires']) && newData.child('expires').isNumber()`
  } },
  groups: { '$gid': {
    '.write': `${signed} && data.child('meta/owner').val() === auth.uid && !newData.exists()`,
    meta: {
      '.read': `${isMember} || ${isGuest}`,
      '.write': `${signed} && ((!data.exists() && newData.child('owner').val() === auth.uid && (root.child('owner').val() === auth.uid || root.child('creators/'+auth.uid).val() === true)) || (${isAdmin} && newData.child('owner').val() === data.child('owner').val()))`,
      '.validate': `newData.hasChildren(['name','owner']) && newData.child('name').isString() && newData.child('name').val().length <= 80`
    },
    members: {
      '.read': isMember,
      '$uid': {
        '.write': `${signed} && (` +
          `(${isAdmin} && ($uid !== ${owner} || newData.child('role').val() === 'admin'))` +
          ` || ($uid === auth.uid && !data.exists() && !${owner.replace(".child('meta/owner').val()", ".child('meta').exists()")} && newData.parent().parent().child('meta/owner').val() === auth.uid && newData.child('role').val() === 'admin')` +
          ` || ($uid === auth.uid && !data.exists() && newData.exists() && ${invite}.child('gid').val() === $gid && ${invite}.child('expires').val() > now && newData.child('role').val() === ${invite}.child('role').val())` +
          ` || ($uid === auth.uid && data.exists() && $uid !== ${owner} && (!newData.exists() || newData.child('role').val() === data.child('role').val()))` +
          ` || ($uid === auth.uid && data.exists() && $uid === ${owner} && newData.child('role').val() === 'admin')` +
          `)`,
        '.validate': `newData.hasChildren(['role','name']) && newData.child('name').isString() && newData.child('name').val().length <= 60 && (newData.child('role').val() === 'admin' || newData.child('role').val() === 'leader' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer')`
      }
    },
    areas: {
      '.read': isMember,
      '$aid': { '.read': guestArea, '.write': canEdit, '.validate': `newData.child('name').isString() && newData.child('name').val().length <= 80` }
    },
    pins: {
      '.read': isMember,
      '$aid': { '.read': guestArea, '.write': canEdit,
        '$pid': { '.validate': `newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('typeId').isString()` } }
    },
    types: { '.read': `${isMember} || ${isGuest}`, '$tid': { '.write': canEdit, '.validate': `newData.child('name').isString() && newData.child('color').isString()` } },
    hunts: {
      '.read': isMember,
      '$hid': {
        '.read': `${isGuest} && ${guest}.child('hid').val() === $hid`,
        '.write': canLead,
        '.validate': `newData.hasChildren(['name','expires','code']) && newData.child('expires').isNumber() && (!newData.child('starts').exists() || (newData.child('starts').isNumber() && newData.child('starts').val() < newData.child('expires').val()))`
      }
    },
    guests: {
      '.read': isMember,
      '$uid': {
        '.read': `${signed} && auth.uid === $uid`,
        '.write': `${canLead} || (${signed} && $uid === auth.uid && (!newData.exists() || (${hcode}.child('gid').val() === $gid && ${hcode}.child('hid').val() === newData.child('hid').val() && ${hcode}.child('expires').val() > now && newData.child('expires').val() === ${hcode}.child('expires').val())))`,
        '.validate': `newData.hasChildren(['hid','code','name','expires']) && newData.child('name').isString() && newData.child('name').val().length <= 60`
      }
    },
    // Positioner finns bara per jakt och kan bara läsas och skrivas medan jakten pågår.
    huntPos: {
      '$hid': {
        '.read': `(${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && $uid === auth.uid && ${huntLive} && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
          '.validate': `newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber()`
        }
      }
    },
    // Spår (tidigare positioner) per jakt, med samma åtkomst som positionerna.
    huntTrail: {
      '$hid': {
        '.read': `(${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && $uid === auth.uid && ${huntLive} && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
          '$pt': { '.validate': `newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber() && newData.child('t').val() <= now + 60000` }
        }
      }
    }
  } }
} };
module.exports = rules;
if (require.main === module) { require('fs').writeFileSync(process.argv[2] || 'database.rules.json', JSON.stringify(rules, null, 2)); console.log('ok'); }
