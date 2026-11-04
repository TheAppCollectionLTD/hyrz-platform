require('dotenv').config();

const db = require('../src/db');
const bcrypt = require('bcryptjs');
const { hashIdentifier } = require('../src/identifier-hash');

const accounts = [
  {
    email: 'demo.worker@hyrz.local',
    password: 'HyrzDemoWorker!2026',
    role: 'worker',
    firstName: 'Alex',
    lastName: 'Demo',
    identifier: 'HYRZDEMOWORKER2026'
  },
  {
    email: 'demo.employer@hyrz.local',
    password: 'HyrzDemoEmployer!2026',
    role: 'employer',
    firstName: 'Sam',
    lastName: 'Demo',
    businessName: 'The Demo Bar & Kitchen',
    companyNumber: null,
    companyRole: 'General Manager',
    address: '1 Demo Street',
    city: 'London',
    postcode: 'EC1A 4AA'
  },
  {
    email: 'test.worker@hyrz.local',
    password: 'HyrzTestWorker!2026',
    role: 'worker',
    firstName: 'Taylor',
    lastName: 'Testworker',
    identifier: 'HYRZTESTWORKER2026'
  },
  {
    email: 'test.worker2@hyrz.local',
    password: 'HyrzTestWorker2!2026',
    role: 'worker',
    firstName: 'Casey',
    lastName: 'Testworker',
    identifier: 'HYRZTESTWORKER22026'
  },
  {
    email: 'test.employer2@hyrz.local',
    password: 'HyrzTestEmployer2!2026',
    role: 'employer',
    firstName: 'Morgan',
    lastName: 'Testemployer',
    businessName: 'hyrz Test Staffing Two Ltd',
    companyNumber: null,
    companyRole: 'Staffing Manager',
    address: '20 Test Street',
    city: 'London',
    postcode: 'EC1A 2AA'
  },
  {
    email: 'test.employer@hyrz.local',
    password: 'HyrzTestEmployer!2026',
    role: 'employer',
    firstName: 'Jordan',
    lastName: 'Testemployer',
    businessName: 'hyrz Test Staffing Ltd',
    companyNumber: null,
    companyRole: 'Staffing Manager',
    address: '10 Test Street',
    city: 'London',
    postcode: 'EC1A 1AA'
  }
];

async function main() {
  // This script must never seed a production or general development database.
  if (process.env.DB_NAME !== 'hyrz_test') {
    throw new Error('Refusing to seed accounts: DB_NAME must be exactly "hyrz_test". No data was changed.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const account of accounts) {
      const email = account.email.toLowerCase();
      const [existing] = await conn.execute('SELECT id, role FROM users WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
      let userId;

      if (existing.length) {
        if (existing[0].role !== account.role) {
          throw new Error('Existing test email has the wrong account role: ' + email);
        }
        userId = existing[0].id;
        await conn.execute(
          'UPDATE users SET password_hash=?, first_name=?, last_name=?, email_verified_at=COALESCE(email_verified_at, UTC_TIMESTAMP()), status=\'active\' WHERE id=?',
          [await bcrypt.hash(account.password, 12), account.firstName, account.lastName, userId]
        );
      } else {
        const [created] = await conn.execute(
          'INSERT INTO users (email,password_hash,role,first_name,last_name,email_verified_at,status) VALUES (?,?,?,?,?,UTC_TIMESTAMP(),\'active\')',
          [email, await bcrypt.hash(account.password, 12), account.role, account.firstName, account.lastName]
        );
        userId = created.insertId;
      }

      if (account.role === 'worker') {
        await conn.execute(
          'INSERT INTO worker_profiles (user_id,national_insurance_hash,worker_permit_hash,identity_verification_status,right_to_work_status) VALUES (?,?,?,\'verified\',\'verified\') ON DUPLICATE KEY UPDATE national_insurance_hash=VALUES(national_insurance_hash), worker_permit_hash=VALUES(worker_permit_hash), identity_verification_status=\'verified\', right_to_work_status=\'verified\'',
          [userId, hashIdentifier(account.identifier), null]
        );
      } else {
        await conn.execute(
          'INSERT INTO businesses (owner_user_id,name,company_number,postcode,role_at_company,address_line_1,city,identity_verification_status,verification_status) VALUES (?,?,?,?,?,?,?,\'verified\',\'verified\') ON DUPLICATE KEY UPDATE name=VALUES(name),postcode=VALUES(postcode),role_at_company=VALUES(role_at_company),address_line_1=VALUES(address_line_1),city=VALUES(city),identity_verification_status=\'verified\',verification_status=\'verified\'',
          [userId, account.businessName, account.companyNumber, account.postcode, account.companyRole, account.address, account.city]
        );
      }

      console.log('Ready: ' + account.role + ' ' + email);
    }


    // Create a predictable Tier 1 owner exclusively in the isolated test database.
    const ownerEmail = 'test.owner@hyrz.local';
    const ownerPasswordHash = await bcrypt.hash('Test-Only-Password-2026!', 12);
    const [existingOwner] = await conn.execute('SELECT id, role FROM users WHERE LOWER(TRIM(email))=? LIMIT 1', [ownerEmail]);
    let ownerId;
    if (existingOwner.length) {
      if (existingOwner[0].role !== 'admin') {
        throw new Error('Existing test owner email has the wrong account role: ' + ownerEmail);
      }
      ownerId = existingOwner[0].id;
      await conn.execute("UPDATE users SET password_hash=?, admin_tier=1, status='active', email_verified_at=COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id=?", [ownerPasswordHash, ownerId]);
    } else {
      const [createdOwner] = await conn.execute("INSERT INTO users(email,password_hash,role,admin_tier,status,email_verified_at,first_name,last_name) VALUES(?,?,'admin',1,'active',UTC_TIMESTAMP(),'Test','Owner')", [ownerEmail, ownerPasswordHash]);
      ownerId = createdOwner.insertId;
    }
    await conn.execute('INSERT INTO admin_login_names(user_id,username) VALUES(?,?) ON DUPLICATE KEY UPDATE username=VALUES(username)', [ownerId, 'SimsonH']);
    console.log('Ready: Tier 1 test owner ' + ownerEmail);

    await conn.commit();
    console.log('Test accounts are ready in hyrz_test. These are fictional accounts for local testing only.');
    console.log('Demo worker:   demo.worker@hyrz.local / HyrzDemoWorker!2026');
    console.log('Demo employer: demo.employer@hyrz.local / HyrzDemoEmployer!2026');
    console.log('Worker 1:   test.worker@hyrz.local / HyrzTestWorker!2026');
    console.log('Employer 1: test.employer@hyrz.local / HyrzTestEmployer!2026');
    console.log('Worker 2:   test.worker2@hyrz.local / HyrzTestWorker2!2026');
    console.log('Employer 2: test.employer2@hyrz.local / HyrzTestEmployer2!2026');
    console.log('Test admin (integration tests only): test.owner@hyrz.local / Test-Only-Password-2026!');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
