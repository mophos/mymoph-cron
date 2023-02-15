var cron = require('node-cron');
require('dotenv').config();
const axios = require("axios").default;
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

var isLoopFirewall = false
// first time on start service
getRSSPH();
updateAdvertise();
updateFirewall203_157_4_235();

//every 5 sec
cron.schedule('*/5 * * * * *', () => {
    updateFirewall203_157_4_235();
});

//every hours
cron.schedule('0 * * * *', () => {
    getRSSPH();
});

//every 10 minutes
cron.schedule('*/10 * * * *', () => {
    updateAdvertise();
});


async function getRSSPH() {
    try {
        console.log("update rss pr at " + new Date().toLocaleString());
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
    // console.log('get RSS PR Success!');
}

function getPR(id) {
    const options = {
        method: 'GET',
        url: `https://pr.moph.go.th/rss_prmoph.php?id=${id}`,
        headers: {
            'Content-Type': 'application/json'
        },
        json: true
    };
    return new Promise((resolve, reject) => {
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            reject({ statusCode: error.status, error: error.message });
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
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            reject({ statusCode: error.status, error: error.message });
        });
    });
}

async function updateAdvertise() {
    try {
        console.log("update advertise at " + new Date().toLocaleString());
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

async function updateFirewall203_157_4_235() {
    if (!isLoopFirewall) {
        isLoopFirewall = true;
        await getFirewall203_157_4_235(true, false).then(async (rs) => {
            if (rs.length) {
                console.log("update firewall add " + new Date().toLocaleString());
            }
            for (const i of rs) {
                const create = await callCreateAddressFirewall203_157_4_235(i.cid, i.mac_address,vdom);
                if (create.statusCode == 200) {
                    const add = await callAddAddressFirewall203_157_4_235(i.cid, i.mac_address,vdom);
                    if (add.statusCode == 200) {
                        await updateCreateDBFirewall203_157_4_235(i.id);
                    }
                }
            }
        }).catch((e) => {
            console.log(e);
        })
        await getFirewall203_157_4_235(false, true).then(async (rs) => {
            if (rs.length) {
                console.log("update firewall remove " + new Date().toLocaleString());
            }
            for (const i of rs) {
                const create = await callRemoveMemberAddressFirewall203_157_4_235(i.cid, i.mac_address,vdom);
                if (create.statusCode == 200) {
                    const add = await callRemoveAddressFirewall203_157_4_235(i.cid, i.mac_address,vdom);
                    if (add.statusCode == 200) {
                        await updateRemoveDBFirewall203_157_4_235(i.id);
                    }
                }
            }
        }).catch((e) => {
            console.log(e);
        })
        isLoopFirewall = false;
    }
}

function getFirewall203_157_4_235(isCreated, isDeleted) {
    const sql = db('device_wifi_moph').where('firewall_url', '203.157.4.235');
    if (isCreated) {
        sql.where('is_created_policy', 'N')
        sql.where('is_deleted', 'N')
    } else if (isDeleted) {
        sql.where('is_deleted', 'Y')
        sql.where('id_deleted_policy', 'N')
    }
    return sql;
}

function updateCreateDBFirewall203_157_4_235(id) {
    return db('device_wifi_moph').where('firewall_url', '203.157.4.235').where('id', id).update('is_created_policy', 'Y')
}

function updateRemoveDBFirewall203_157_4_235(id) {
    return db('device_wifi_moph').where('firewall_url', '203.157.4.235').where('id', id).update('id_deleted_policy', 'Y')
}

function callCreateAddressFirewall203_157_4_235(cid, macAddress,vdom) {
    const options = {
        method: 'POST',
        url: 'https://203.157.4.235/api/v2/cmdb/firewall/address',
        params: { access_token: process.env.FIREWALL203_157_4_235_KEY, vdom: vdom },
        headers: { 'Content-Type': 'application/json' },
        data: {
            name: `mymoph_${cid}_${macAddress}`,
            type: 'mac',
            'start-mac': macAddress,
            'end-mac': macAddress
        },
        rejectUnauthorized: false
    };
    return new Promise((resolve, reject) => {
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            console.log(error);
            reject({ statusCode: error.status, error: error.message });
        });
    });
}

function callAddAddressFirewall203_157_4_235(cid, macAddress,vdom) {
    const options = {
        method: 'POST',
        url: 'https://203.157.4.235/api/v2/cmdb/firewall/addrgrp/MyMOPH@MacAddress/member',
        params: { access_token: process.env.FIREWALL203_157_4_235_KEY, vdom: vdom },
        headers: { 'Content-Type': 'application/json' },
        data: { "name": `mymoph_${cid}_${macAddress}` },
        rejectUnauthorized: false
    };
    return new Promise((resolve, reject) => {
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            console.log(error);
            reject({ statusCode: error.status, error: error.message });
        });
    });
}

function callRemoveMemberAddressFirewall203_157_4_235(cid, macAddress,vdom) {
    const options = {
        method: 'DELETE',
        url: `https://203.157.4.235/api/v2/cmdb/firewall/addrgrp/MyMOPH@MacAddress/member/mymoph_${cid}_${macAddress}`,
        params: { access_token: process.env.FIREWALL203_157_4_235_KEY, vdom: vdom },
        headers: { 'Content-Type': 'application/json' }
    };
    return new Promise((resolve, reject) => {
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            reject({ statusCode: error.status, error: error.message });
        });
    });
}

function callRemoveAddressFirewall203_157_4_235(cid, macAddress,vdom) {
    const options = {
        method: 'DELETE',
        url: `https://203.157.4.235/api/v2/cmdb/firewall/address`,
        params: { access_token: process.env.FIREWALL203_157_4_235_KEY, vdom: vdom },
        headers: { 'Content-Type': 'application/json' },
        data: { "name": `mymoph_${cid}_${macAddress}` }
    };
    return new Promise((resolve, reject) => {
        axios.request(options).then(function (response) {
            resolve({ statusCode: response.status, body: response.data });
        }).catch(function (error) {
            reject({ statusCode: error.status, error: error.message });
        });
    });
}