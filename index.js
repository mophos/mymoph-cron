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
cron.schedule('0 * * * *', () => {
    getRSSPH();
});


// callHour();
// function callHour() {
//     getRSSPH();
//     // updatePayslip();
// }

updateAdvertise();
//every 10 minutes
cron.schedule('*/10 * * * *', () => {
    console.log("update advertise at " + new Date().toLocaleString());
    updateAdvertise();
});


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

function getAllAdvertise() {
    const options = {
        method: 'GET',
        url: `https://mymoph.moph.go.th/mymoph_api/news/all/0/10`,
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

async function updateAdvertise() {
    try {
        await getAllAdvertise().then(async (rs) => {
            if (rs.statusCode == 200) {
                var rs_list = rs.body;
                var old_data_list = await db.select('id').from('advertise');
                // console.log(old_data_list);

                //find data for delete
                var delete_list = [];
                old_data_list.forEach(element => {
                    var id = element.id;
                    const index = rs_list.findIndex(object => {
                        return object.id === id;
                    });
                    if (index == -1) {
                        delete_list.push(id);
                    }
                });

                // console.log(delete_list, "<---delete");
                delete_list.forEach(async element => {
                    await db('advertise')
                        .where('id', element)
                        .del();
                });

                rs_list.forEach(async element => {
                    var id = element.id;
                    await updateAdvertiseByrecord(id, element);
                });

            }
        }).catch((e) => {
            console.log(e);
        })

    } catch (error) {
        console.log(error);
    }
}

async function updateAdvertiseByrecord(id, data) {

    return await db('advertise').insert({
        "id": id,
        "created": new Date(data.created),
        "updated": new Date(data.updated),
        "title": data.title,
        "detail": data.detail,
        "image_cover": data.image_cover,
        "image_cover_base64": data.image_cover_base64,
        "read": data.read,
        "userid": data.userid,
        "startdate": new Date(data.startdate),
        "enddate": new Date(data.enddate),
        "alway_show": data.alway_show,
        "advertisetypeId": data.advertisetypeId,
    }).onConflict('id')
        .merge({
            "created": new Date(data.created),
            "updated": new Date(data.updated),
            "title": data.title,
            "detail": data.detail,
            "image_cover": data.image_cover,
            "image_cover_base64": data.image_cover_base64,
            "read": data.read,
            "userid": data.userid,
            "startdate": new Date(data.startdate),
            "enddate": new Date(data.enddate),
            "alway_show": data.alway_show,
            "advertisetypeId": data.advertisetypeId,
        });

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