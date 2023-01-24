var cron = require('node-cron');
require('dotenv').config();
const request = require('request');
const db = require('knex')({
    client: 'mysql',
    connection: {
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        multipleStatements: true,
        debug: false
    }
});


getRSSPH()
cron.schedule('*/10 * * * * *', () => {
    getRSSPH();
});


// callHour();
// function callHour() {
//     getRSSPH();
//     // updatePayslip();
// }

async function getRSSPH() {
    console.time('pr');
    try {
        await getPR(1).then(async (rs) => {
            if (rs.statusCode == 200) {
                await updatePRDB(1, rs.body);
            }
        }).catch((e) => {
            console.log(e);
        })
        await getPR(2).then(async (rs) => {
            if (rs.statusCode == 200) {
                await updatePRDB(2, rs.body);
            }
        }).catch((e) => {
            console.log(e);
        })

    } catch (error) {
        console.log(error);
    }
    console.timeEnd('pr');
    // console.log('get RSS PR Success!');
}


function getPR(id) {
    const key = process.env.ekyc_appId;
    const options = {
        method: 'GET',
        url: `https://pr.moph.go.th/rss_prmoph.php?id=${id}`,
        headers: {
            'Content-Type': 'application/json'
        },
        json: true
    };
    return new Promise((resolve, reject) => {
        request(options, function (error, response, body) {
            if (error) {
                reject({ statusCode: response.statusCode, error: error });
            } else {
                resolve({ statusCode: response.statusCode, body: body });
            }
        });
    });
}

function updatePRDB(id, data) {
    return db('rss_moph').where('id', id).update('data', data);
}

// async function updatePayslip() {
//     const users = await getUser();
//     for (const u of users) {
//         const s = await getSlips()
//     }
// }

// function getUser() {
//     return db('users').select('cid').where('cid', '1100400728564')
// }

// function getSlips(accessToken) {
//     try {
//         const options = {
//             method: 'GET',
//             url: 'https://payslip-ops.moph.go.th/api/v1/m/user/slips',
//             headers: {
//                 'Content-Type': 'application/x-www-form-urlencoded',
//                 'Authorization': `Bearer ${accessToken}`,
//             }
//         };
//         return new Promise((resolve, reject) => {
//             request(options, function (error, response, body) {
//                 if (error) {
//                     reject(error)
//                 } else {
//                     try {
//                         resolve(JSON.parse(body))
//                     } catch (error) {
//                         reject(error)
//                     }
//                 }
//             });
//         });
//     } catch (error) {
//         return [];
//     }
// }