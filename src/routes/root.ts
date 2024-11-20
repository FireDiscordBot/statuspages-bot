import * as express from "express";

export const rootRoute = async (
  req: express.Request,
  res: express.Response
) => {
  res.redirect(302, "https://getfire.bot");
};
