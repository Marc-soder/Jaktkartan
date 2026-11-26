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
// Inbjuden till jakten: jakten har ingen lista (hela laget är inbjudet) eller så står man på listan (invited/<uid>).
const invitedOk = `(!root.child(${G}+'/hunts/'+$hid+'/invited').exists() || root.child(${G}+'/hunts/'+$hid+'/invited/'+auth.uid).val() === true)`;
const huntLive = `(${hunt}.child('expires').val() > now && (!${hunt}.child('starts').exists() || ${hunt}.child('starts').val() <= now))`;
// Nycklar som deltagare själva väljer: bara bokstäver, siffror, - och _. Då kan en nyckel aldrig bära med sig kod in i sidan.
const KEY = v => `(${v}.matches(/^[A-Za-z0-9_-]+$/) && ${v}.length <= 64)`;
const hcode = `root.child('huntCodes/'+newData.child('code').val())`;
// Telefonnummer: siffror, mellanslag och bindestreck, gärna med + först (6–20 tecken)
const PHONE = "newData.isString() && newData.val().matches(/^[+]?[0-9][0-9 -]{4,18}[0-9]$/)";
// Databasen som den blir efter skrivningen, sett från groups/$gid/<nod>/$uid (fyra nivåer upp). Används när flera ställen
// skrivs i samma uppdatering: en engångskod måste markeras som använd (invites/<kod>/usedBy) i samma skrivning som man går med.
const newRoot = 'newData.parent().parent().parent().parent()';
const inviteOk = role => `${invite}.child('gid').val() === $gid && ${invite}.child('expires').val() > now && ${role} === ${invite}.child('role').val()` +
  ` && (${invite}.child('once').val() !== true || (!${invite}.child('usedBy').exists() && ${newRoot}.child('invites/'+newData.child('code').val()+'/usedBy').val() === auth.uid))`;

const rules = { rules: {
  '.read': false, '.write': false,
  owner: { '.read': signed, '.write': `${signed} && !data.exists() && newData.val() === auth.uid && auth.token.firebase.sign_in_provider !== 'anonymous'` },
  creators: { '$uid': { '.read': `${signed} && (auth.uid === $uid || root.child('owner').val() === auth.uid)`, '.write': `${signed} && root.child('owner').val() === auth.uid`, '.validate': 'newData.isBoolean()' } },
  // Egen profil (telefonnummer och om det ska delas). Bara man själv läser och skriver.
  profiles: { '$uid': {
    '.read': `${signed} && auth.uid === $uid`, '.write': `${signed} && auth.uid === $uid`,
    phone: {'.validate': PHONE}, share: {'.validate': 'newData.isBoolean()'}, '$other': {'.validate': false}
  } },
  userGroups: { '$uid': { '.read': `${signed} && auth.uid === $uid`, '.write': `${signed} && auth.uid === $uid` } },
  // Inbjudningar till ett jaktlag. Admin skapar och återkallar. once: engångskod, approve: admin godkänner den som går med.
  invites: { '$code': {
    '.read': signed,
    '.write': `${signed} && ((!data.exists() && ${adminOf("newData.child('gid').val()")}) || (data.exists() && !newData.exists() && ${adminOf("data.child('gid').val()")}))`,
    '.validate': `$code.length >= 8 && newData.hasChildren(['gid','role','expires']) && newData.child('expires').isNumber() && (newData.child('role').val() === 'leader' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer')`,
    gid: {'.validate': 'newData.isString()'}, role: {'.validate': true}, expires: {'.validate': true}, by: {'.validate': 'newData.isString()'},
    once: {'.validate': 'newData.isBoolean()'}, approve: {'.validate': 'newData.isBoolean()'},
    team: {'.validate': 'newData.isString() && newData.val().length <= 80'},
    // En engångskod markeras som använd av den som går med, i samma skrivning som medlemskapet eller förfrågan.
    usedBy: {
      '.write': `${signed} && !data.exists() && newData.val() === auth.uid && data.parent().child('once').val() === true && data.parent().child('expires').val() > now` +
        ` && (newData.parent().parent().parent().child('groups/'+data.parent().child('gid').val()+'/members/'+auth.uid+'/code').val() === $code` +
        ` || newData.parent().parent().parent().child('groups/'+data.parent().child('gid').val()+'/requests/'+auth.uid+'/code').val() === $code)`,
      '.validate': 'newData.isString()'
    },
    '$other': {'.validate': false}
  } },
  huntCodes: { '$code': {
    '.read': signed,
    // Jaktledaren skapar och tar bort koden, och kan ändra sluttiden när jakten ändras (men inte flytta koden till en annan jakt).
    '.write': `${signed} && ((!data.exists() && ${leadOf("newData.child('gid').val()")}) || (data.exists() && !newData.exists() && ${leadOf("data.child('gid').val()")}) || (data.exists() && newData.exists() && ${leadOf("data.child('gid').val()")} && newData.child('gid').val() === data.child('gid').val() && newData.child('hid').val() === data.child('hid').val()))`,
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
          ` || ($uid === auth.uid && !data.exists() && newData.exists() && ${invite}.child('approve').val() !== true && ${inviteOk("newData.child('role').val()")})` +
          ` || ($uid === auth.uid && data.exists() && $uid !== ${owner} && (!newData.exists() || newData.child('role').val() === data.child('role').val()))` +
          ` || ($uid === auth.uid && data.exists() && $uid === ${owner} && newData.child('role').val() === 'admin')` +
          `)`,
        '.validate': `newData.hasChildren(['role','name']) && newData.child('name').isString() && newData.child('name').val().length <= 60 && (newData.child('role').val() === 'admin' || newData.child('role').val() === 'leader' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer')`
      }
    },
    // Förfrågningar från den som gått med med en kod som kräver godkännande. Admin ser dem och godkänner (skriver
    // medlemmen) eller nekar (tar bort förfrågan). Den som frågar ser sin egen förfrågan och kan dra tillbaka den.
    requests: {
      '.read': isAdmin,
      '$uid': {
        '.read': `${signed} && auth.uid === $uid`,
        '.write': `${signed} && ((${isAdmin} && !newData.exists()) || ($uid === auth.uid && !newData.exists())` +
          ` || ($uid === auth.uid && !data.exists() && newData.exists() && !${me}.exists() && ${invite}.child('approve').val() === true && ${inviteOk("newData.child('role').val()")}))`,
        '.validate': `newData.hasChildren(['name','role','code','t']) && newData.child('name').isString() && newData.child('name').val().length <= 60 && (newData.child('role').val() === 'leader' || newData.child('role').val() === 'editor' || newData.child('role').val() === 'viewer') && newData.child('code').isString() && newData.child('t').isNumber()`,
        name: {'.validate': true}, role: {'.validate': true}, code: {'.validate': true}, t: {'.validate': true},
        team: {'.validate': 'newData.isString() && newData.val().length <= 80'},
        '$other': {'.validate': false}
      }
    },
    // Lagets inbjudningar, så att admin kan se och återkalla dem (koderna i invites går inte att lista).
    inviteList: {
      '.read': isAdmin,
      '$code': {
        '.write': isAdmin,
        '.validate': `${KEY('$code')} && newData.hasChildren(['role','expires','t']) && newData.child('expires').isNumber() && newData.child('t').isNumber()`,
        role: {'.validate': "newData.val() === 'leader' || newData.val() === 'editor' || newData.val() === 'viewer'"},
        expires: {'.validate': true}, t: {'.validate': true},
        once: {'.validate': 'newData.isBoolean()'}, approve: {'.validate': 'newData.isBoolean()'},
        to: {'.validate': 'newData.isString() && newData.val().length <= 40'},
        '$other': {'.validate': false}
      }
    },
    areas: {
      '.read': isMember,
      '$aid': { '.read': guestArea, '.write': canEdit, '.validate': `${KEY('$aid')} && newData.child('name').isString() && newData.child('name').val().length <= 80` }
    },
    pins: {
      '.read': isMember,
      '$aid': { '.read': guestArea, '.write': canEdit, '.validate': KEY('$aid'),
        '$pid': { '.validate': `${KEY('$pid')} && newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('typeId').isString()` } }
    },
    types: { '.read': `${isMember} || ${isGuest}`, '$tid': { '.write': canEdit, '.validate': `${KEY('$tid')} && newData.child('name').isString() && newData.child('color').isString()` } },
    hunts: {
      '.read': isMember,
      '$hid': {
        '.read': `${isGuest} && ${guest}.child('hid').val() === $hid`,
        '.write': canLead,
        '.validate': `${KEY('$hid')} && newData.hasChildren(['name','expires','code']) && newData.child('expires').isNumber() && (!newData.child('starts').exists() || (newData.child('starts').isNumber() && newData.child('starts').val() < newData.child('expires').val()))`,
        // Utvalda medlemmar som bjuds in. Saknas listan är hela laget inbjudet.
        invited: { '$uid': { '.validate': `${KEY('$uid')} && newData.val() === true` } }
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
          '.write': `${signed} && $uid === auth.uid && ${huntLive} && ((${me}.exists() && ${invitedOk}) || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
          '.validate': `newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber()`
        }
      }
    },
    // Viltobservationer per jakt. Alla deltagare (medlemmar och jaktens gäster) ser och lägger till under pågående jakt.
    // Man ändrar och tar bort sina egna. Jaktledare och admin kan ta bort alla.
    huntObs: {
      '$hid': {
        // Jaktledare och admin får läsa även efter jaktens slut, så att observationerna kan arkiveras när jakten tas bort.
        '.read': `((${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}) || ${canLead}`,
        '.write': `${canLead} && !newData.exists()`,
        '$oid': {
          '.write': `${signed} && ${huntLive} && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid)) && (newData.exists() ? (newData.child('by').val() === auth.uid && (!data.exists() || data.child('by').val() === auth.uid)) : (data.child('by').val() === auth.uid || ${canLead}))`,
          '.validate': `${KEY('$oid')} && newData.hasChildren(['sp','n','lat','lng','t','by']) && newData.child('sp').isString() && newData.child('sp').val().length >= 1 && newData.child('sp').val().length <= 40 && newData.child('n').isNumber() && newData.child('n').val() >= 1 && newData.child('n').val() <= 999 && newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber() && newData.child('t').val() <= now + 60000 && (!newData.child('note').exists() || (newData.child('note').isString() && newData.child('note').val().length <= 200)) && (!newData.child('name').exists() || (newData.child('name').isString() && newData.child('name').val().length <= 60))`,
          // Fällt vilt: kind 'kill' med kön, ålder och skytt. En vanlig observation har kind 'obs' eller inget kind.
          kind: {'.validate': "newData.val() === 'obs' || newData.val() === 'kill'"},
          sex: {'.validate': "newData.val() === 'm' || newData.val() === 'f' || newData.val() === 'u'"},
          age: {'.validate': "newData.val() === 'ad' || newData.val() === 'juv' || newData.val() === 'u'"},
          shooter: {'.validate': 'newData.isString() && newData.val().length <= 60'}
        }
      }
    },
    // Deltagarnas utrustning för planeringen: vapen (hagel, kula eller båda) och om de behöver ett lättillgängligt pass.
    // Bara jaktledare och admin läser och skriver.
    gear: {
      '.read': canLead,
      '$uid': {
        '.write': canLead,
        '.validate': `${KEY('$uid')} && newData.hasChildren(['name'])`,
        name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
        gun: {'.validate': "newData.val() === 'hagel' || newData.val() === 'kula' || newData.val() === 'both'"},
        easy: {'.validate': 'newData.isBoolean()'},
        '$other': {'.validate': false}
      }
    },
    // Arkiv med tidigare viltobservationer för värmekartan. Utan namn: bara art, antal, plats, tid och jakt.
    // Bara jaktledare och admin läser och skriver (arkiveringen sker när en jakt avslutas eller tas bort).
    obsArchive: {
      '.read': canLead,
      '$oid': {
        '.write': canLead,
        '.validate': `${KEY('$oid')} && newData.hasChildren(['sp','n','lat','lng','t']) && newData.child('sp').isString() && newData.child('sp').val().length >= 1 && newData.child('sp').val().length <= 40 && newData.child('n').isNumber() && newData.child('n').val() >= 1 && newData.child('n').val() <= 999 && newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber() && newData.child('t').val() <= now + 60000`,
        sp: {'.validate': true}, n: {'.validate': true}, lat: {'.validate': true}, lng: {'.validate': true}, t: {'.validate': true},
        hid: {'.validate': 'newData.isString() && newData.val().length <= 40'},
        kind: {'.validate': "newData.val() === 'obs' || newData.val() === 'kill'"},
        '$other': {'.validate': false}
      }
    },
    // Plan för en jakt: vem som står på vilket pass, förbjudna skjutriktningar per pass, såtar och vägar för
    // hundförare och drevkarlar. Görs innan jakten startar, så den kan läsas även före start: av lagets medlemmar
    // och av jaktens gäster. Bara jaktledare och admin ändrar den. Tas bort när jakten avslutas.
    huntPlan: {
      '.read': isMember,
      '$hid': {
        '.read': `${isGuest} && ${guest}.child('hid').val() === $hid`,
        '.write': `${canLead} && (${hunt}.exists() || !newData.exists())`,
        // Pass för hela jakten (när jakten inte är uppdelad i såtar) och förbjudna skjutriktningar (gäller i alla såtar).
        // ok: jaktledaren har godkänt placeringen trots en varning (lättillgängligt pass, hagel eller kula).
        stands: { '$pid': {
          '.validate': KEY('$pid'),
          who: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          uid: {'.validate': 'newData.isString() && newData.val().length <= 128'},
          no: {'.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 65535 && newData.val() % 1 === 0'},
          ok: {'.validate': 'newData.isBoolean()'},
          '$other': {'.validate': false}
        } },
        // Såtar: en i taget, i ordningen ord. Varje såt har egna pass. done = när såten bröts.
        drives: { '$did': {
          '.validate': `${KEY('$did')} && newData.hasChildren(['name','ring'])`,
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          ring: {'.validate': 'newData.isString() && newData.val().length <= 20000'},
          ord: {'.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 1000'},
          done: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          pass: { '$pid': {
            '.validate': KEY('$pid'),
            who: {'.validate': 'newData.isString() && newData.val().length <= 60'},
            uid: {'.validate': 'newData.isString() && newData.val().length <= 128'},
            ok: {'.validate': 'newData.isBoolean()'},
            '$other': {'.validate': false}
          } },
          '$other': {'.validate': false}
        } },
        routes: { '$rid': {
          '.validate': `${KEY('$rid')} && newData.hasChildren(['kind','pts'])`,
          kind: {'.validate': "newData.val() === 'hund' || newData.val() === 'drev'"},
          who: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          uid: {'.validate': 'newData.isString() && newData.val().length <= 128'},
          pts: {'.validate': 'newData.isString() && newData.val().length <= 20000'},
          drive: {'.validate': KEY('newData.val()')},
          '$other': {'.validate': false}
        } },
        // Samlingsplatser som jaktledaren kan kalla till
        meets: { '$mid': {
          '.validate': `${KEY('$mid')} && newData.hasChildren(['name','lat','lng'])`,
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          lat: {'.validate': 'newData.isNumber() && newData.val() >= -90 && newData.val() <= 90'},
          lng: {'.validate': 'newData.isNumber() && newData.val() >= -180 && newData.val() <= 180'},
          '$other': {'.validate': false}
        } },
        // Pågående eller senast brutna såt
        cur: {
          '.validate': "newData.hasChildren(['did','on','t'])",
          did: {'.validate': KEY('newData.val()')},
          on: {'.validate': 'newData.isBoolean()'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          '$other': {'.validate': false}
        },
        // Återsamling: en kopia av samlingsplatsen, så att den finns kvar även om platsen ändras
        call: {
          '.validate': "newData.hasChildren(['name','lat','lng','t'])",
          mid: {'.validate': KEY('newData.val()')},
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          lat: {'.validate': 'newData.isNumber() && newData.val() >= -90 && newData.val() <= 90'},
          lng: {'.validate': 'newData.isNumber() && newData.val() >= -180 && newData.val() <= 180'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          '$other': {'.validate': false}
        },
        '$other': {'.validate': false}
      }
    },
    // Vilka medlemmar som deltar i en jakt ("Jag deltar"). Hos den som deltar delas positionen automatiskt
    // medan jakten pågår. Laget ser vilka som deltar. Man svarar bara för sig själv. Tas bort när jakten avslutas.
    // Telefonnummer per jakt. Den som deltar och valt att dela lägger in sitt nummer. Bara jaktens deltagare
    // (medlemmar som svarat Jag deltar, och jaktens gäster) och jaktledare ser numren, och bara medan jakten pågår.
    huntPhone: {
      '$hid': {
        '.read': `${huntLive} && ((${isMember} && (${canLead} || (root.child(${G}+'/huntRsvp/'+$hid+'/'+auth.uid).exists() && root.child(${G}+'/huntRsvp/'+$hid+'/'+auth.uid+'/no').val() !== true))) || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && $uid === auth.uid && (!newData.exists() || (${hunt}.child('expires').val() > now && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid))))`,
          '.validate': `newData.hasChildren(['name','phone','t'])`,
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          phone: {'.validate': PHONE},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          '$other': {'.validate': false}
        }
      }
    },
    huntRsvp: {
      '.read': isMember,
      '$hid': {
        // Jaktens gäster ser vilka som deltar, även före start, så att de vet vilka de ska träffa
        '.read': `${isGuest} && ${guest}.child('hid').val() === $hid`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && (($uid === auth.uid && ${me}.exists() && ((${hunt}.exists() && ${invitedOk}) || !newData.exists())) || (${canLead} && !newData.exists()))`,
          '.validate': `newData.hasChildren(['name','t'])`,
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          // Avböjt: {name, t, no:true}. Utan no betyder svaret att man deltar.
          no: {'.validate': 'newData.isBoolean()'},
          '$other': {'.validate': false}
        }
      }
    },
    // Publika nycklar för krypterade meddelanden, en per enhet: msgKeys/<uid>/<enhet> = {k, name, t, hid?}.
    // Lagets medlemmar och gäster läser dem (för att kunna kryptera till varandra). Var och en skriver bara sina egna.
    // En gäst märker sin nyckel med sin jakt. Jaktledare och admin kan ta bort nycklar (gästernas, när jakten avslutas).
    msgKeys: {
      '.read': `${isMember} || ${isGuest}`,
      '$uid': {
        '.write': `${signed} && (($uid === auth.uid && (${me}.exists() || ${isGuest})) || (${canLead} && !newData.exists()))`,
        '$did': {
          '.validate': `${KEY('$did')} && newData.hasChildren(['k','name','t']) && ($uid !== auth.uid || ${me}.exists() || newData.child('hid').val() === ${guest}.child('hid').val())`,
          k: {'.validate': 'newData.isString() && newData.val().length >= 40 && newData.val().length <= 200'},
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          hid: {'.validate': 'newData.isString() && newData.val().length <= 40'},
          '$other': {'.validate': false}
        }
      }
    },
    // Krypterade meddelanden per jakt. Bara jaktens deltagare läser och skriver, och bara medan jakten pågår.
    // Innehållet är krypterat i webbläsaren till mottagarnas nycklar: databasen ser bara vem som skrivit till vem.
    // Ett meddelande kan inte ändras. Avsändaren tar bort sina egna, jaktledare och admin alla. Raderas när jakten avslutas.
    huntMsg: {
      '$hid': {
        '.read': `(${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}`,
        '.write': `${canLead} && !newData.exists()`,
        '$mid': {
          '.write': `${signed} && ${huntLive} && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid)) && (newData.exists() ? (!data.exists() && newData.child('from').val() === auth.uid) : (data.child('from').val() === auth.uid || ${canLead}))`,
          '.validate': `${KEY('$mid')} && newData.hasChildren(['from','name','t','iv','ct','spk','keys']) && (newData.child('all').val() === true || newData.hasChild('to'))`,
          from: {'.validate': 'newData.isString()'},
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          iv: {'.validate': 'newData.isString() && newData.val().length <= 40'},
          ct: {'.validate': 'newData.isString() && newData.val().length <= 8000'},
          spk: {'.validate': 'newData.isString() && newData.val().length <= 200'},
          all: {'.validate': 'newData.isBoolean()'},
          to: {'$uid': {'.validate': 'newData.val() === true'}},
          keys: {'$k': {'.validate': 'newData.isString() && newData.val().length <= 200'}},
          // Svar: vilket meddelande det svarar på (bara id:t, texten citeras från mottagarens egen kopia)
          re: {'.validate': `newData.isString() && ${KEY('newData.val()')}`},
          '$other': {'.validate': false}
        }
      }
    },
    // Incheckning på passet: huntCheck/<jakt>/<uid> = {pid, in, t, name}. Som positionerna: bara jaktens deltagare,
    // bara medan jakten pågår. Man checkar bara in sig själv, och bara på det pass man är tilldelad i jaktplanen.
    huntCheck: {
      '$hid': {
        '.read': `(${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && $uid === auth.uid && ${huntLive} && (${me}.exists() || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
          '.validate': `newData.hasChildren(['pid','in','t','name'])`,
          pid: {'.validate': `newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]+$/) && newData.val().length <= 64 && root.child(${G}+'/huntPlan/'+$hid+'/stands/'+newData.val()+'/uid').val() === auth.uid`},
          in: {'.validate': 'newData.isBoolean()'},
          t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
          name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
          '$other': {'.validate': false}
        }
      }
    },
    // Nödlarm: sos/<uid> = {t, name, lat, lng, acc}. Hela laget (medlemmar och giltiga gäster) läser, så att alla får larmet.
    // Man larmar bara för sig själv. Jaktledare och admin kan ta bort gamla larm.
    sos: {
      '.read': `${isMember} || ${isGuest}`,
      '$uid': {
        '.write': `${signed} && (($uid === auth.uid && (${me}.exists() || ${isGuest})) || (${canLead} && !newData.exists()))`,
        '.validate': `newData.hasChildren(['t','name'])`,
        t: {'.validate': 'newData.isNumber() && newData.val() <= now + 60000'},
        name: {'.validate': 'newData.isString() && newData.val().length <= 60'},
        lat: {'.validate': 'newData.isNumber() && newData.val() >= -90 && newData.val() <= 90'},
        lng: {'.validate': 'newData.isNumber() && newData.val() >= -180 && newData.val() <= 180'},
        acc: {'.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 100000'},
        '$other': {'.validate': false}
      }
    },
    // Spår (tidigare positioner) per jakt, med samma åtkomst som positionerna.
    huntTrail: {
      '$hid': {
        '.read': `(${isMember} || (${isGuest} && ${guest}.child('hid').val() === $hid)) && ${huntLive}`,
        '.write': `${canLead} && !newData.exists()`,
        '$uid': {
          '.write': `${signed} && $uid === auth.uid && ${huntLive} && ((${me}.exists() && ${invitedOk}) || (${isGuest} && ${guest}.child('hid').val() === $hid))`,
          '$pt': { '.validate': `${KEY('$pt')} && newData.child('lat').isNumber() && newData.child('lng').isNumber() && newData.child('t').isNumber() && newData.child('t').val() <= now + 60000` }
        }
      }
    }
  } }
} };
module.exports = rules;
if (require.main === module) { require('fs').writeFileSync(process.argv[2] || 'database.rules.json', JSON.stringify(rules, null, 2)); console.log('ok'); }
