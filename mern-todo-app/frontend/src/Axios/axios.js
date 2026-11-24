import axios from "axios"

// CRA inlines REACT_APP_* at build time: changing it requires a rebuild / restart of `npm start`.
const instance = axios.create({
    baseURL: process.env.REACT_APP_API_URL || "http://localhost:8000/api"
})
export default instance
