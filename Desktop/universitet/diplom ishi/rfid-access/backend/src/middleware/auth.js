const jwt = require('jsonwebtoken');

module.exports = (roles = []) => {
    return (req, res, next) => {
        const h = req.headers.authorization;
        if (!h) return res.sendStatus(401);

        try {
            const token = h.split(' ')[1];
            const payload = jwt.verify(
                token,
                process.env.JWT_SECRET || 'SECRET'
            );

            // role tekshiruvi
            if (roles.length && !roles.includes(payload.role)) {
                return res.sendStatus(403);
            }

            req.user = payload;
            next();
        } catch (err) {
            return res.sendStatus(403);
        }
    };
};
