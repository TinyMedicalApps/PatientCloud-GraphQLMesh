const moment = require("moment");
const fetch = require("node-fetch");

const flattenObservations = (observations) => {
  return observations.reduce((acc, obs) => {
    if (obs.component) {
      acc.concat(
        obs.component.map((comp) => {
          return { ...obs, ...comp };
        })
      );
    } else {
      acc.push(obs);
    }

    return acc;
  }, []);
};

const sumValueQuantity = (arr) => {
  return arr.reduce((sum, item) => {
    if (item.valueQuantity) {
      return sum + item.valueQuantity.value;
    } else {
      return sum;
    }
  }, 0);
};

const ObservationByPatientWithArgs = async (args) => {
  const { PatientID } = args;

  const res = await fetch(
    `https://api.logicahealth.org/PatientCloud10STU3/open/Observation?${new URLSearchParams({ patient: PatientID })}`,
    {
      method: "GET",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return await res.json();
};

const resolvers = {
  TinyPeakFlowResponse: {
    statsForPeriod: async (parent, args, context, info) => {
      // for each grouped observation, calculate avg
      return Object.entries(parent.grouped).map(([key, obs]) => {
        return {
          AVGMeanValue: sumValueQuantity(obs) / obs.length,
          Date: moment(key, "MM_YYYY").format("MMMM YYYY"),
        };
      });
    },
    statsAllTime: async (parent, args, context, info) => {
      // for all observations, calculate avg and best value
      const bestValue = Math.max(
        ...parent.all.map((e) => {
          return e.valueQuantity.value;
        })
      );

      return {
        BestValue: bestValue,
        EIGHTYPCBestValue: bestValue * 0.8,
        AVGMeanValue: sumValueQuantity(parent.all) / parent.all.length,
      };
    },
  },
  Query: {
    TinyPeakFlowStats: async (parent, args, context, info) => {
      // take PatientID from query arguments
      const { PatientID } = args;

      // const res = await ObservationByPatientWithArgs({
      //   PatientID,
      // });
      const res = await context["LogicaHealth Sandbox v3"].api.ObservationByPatient({
        PatientID,
      });

      // res is { entry: [...list of entries] }
      // for each entry, parse and return the full data object
      return Promise.all(
        res.entry.map(async (el) => {
          try {
            const singleEntry = await fetch(el.fullUrl, {
              method: "GET",
              redirect: "follow",
              headers: {
                "Content-Type": "application/json",
              },
            });

            return await singleEntry.json();
          } catch (error) {
            throw new Error(error);
          }
        })
      )
        .then((result) => {
          // flatten the observations array, because some might have multiple values on the same instance
          // then group by same month+year
          const groupBy = flattenObservations(result).reduce((accumulator, observation) => {
            const monthyear = moment(observation.effectiveDateTime).format("MM_YYYY");

            if (accumulator[monthyear]) {
              accumulator[monthyear].push(observation);
            } else {
              accumulator[monthyear] = [observation];
            }

            return accumulator;
          }, {});

          // return grouped observations as well as the entire flattened list, so underlying resolvers can access these data
          return { grouped: groupBy, all: flattenObservations(result) };
        })
        .catch((error) => {
          throw new Error(error);
        });
    },
  },
};

module.exports = { resolvers };
